import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  createHash,
  createPublicKey,
  createVerify,
  randomBytes,
  type JsonWebKey as CryptoJsonWebKey,
} from 'node:crypto';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { OidcAuthorizationAttempt } from '../entities/oidc-authorization-attempt.entity';
import { OidcAttemptCryptoService } from './oidc-attempt-crypto.service';
import {
  OidcCallbackRejectedException,
  type OidcRejectionCode,
} from './oidc-callback-rejected.exception';

type OidcConfiguration = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  allowedEmailDomains: string[];
};

type DiscoveryDocument = {
  issuer?: unknown;
  authorization_endpoint?: unknown;
  token_endpoint?: unknown;
  jwks_uri?: unknown;
};

type Jwk = JsonWebKey & {
  kid?: unknown;
  use?: unknown;
  alg?: unknown;
};

type JwksDocument = {
  keys?: unknown;
};

type IdTokenPayload = {
  iss?: unknown;
  aud?: unknown;
  azp?: unknown;
  exp?: unknown;
  nbf?: unknown;
  sub?: unknown;
  nonce?: unknown;
  email?: unknown;
  email_verified?: unknown;
  realm_access?: unknown;
  resource_access?: unknown;
};

export type KeycloakIdentity = {
  subject: string;
  email: string;
  isWorkCopilotAdmin: boolean;
};

@Injectable()
export class KeycloakOidcService {
  private static readonly ATTEMPT_TTL_MS = 10 * 60 * 1000;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(OidcAuthorizationAttempt)
    private readonly attemptsRepository: Repository<OidcAuthorizationAttempt>,
    private readonly attemptCryptoService: OidcAttemptCryptoService,
  ) {}

  async createAuthorizationUrl(): Promise<string> {
    const configuration = this.getConfiguration();
    const discovery = await this.fetchDiscovery(configuration);
    const state = this.randomUrlSafeValue();
    const nonce = this.randomUrlSafeValue();
    const verifier = this.randomUrlSafeValue(48);
    const encryptedVerifier = this.attemptCryptoService.encrypt(verifier);

    await this.attemptsRepository.save(
      this.attemptsRepository.create({
        stateHash: this.hash(state),
        nonceHash: this.hash(nonce),
        pkceVerifierCiphertext: encryptedVerifier.ciphertext,
        pkceVerifierIv: encryptedVerifier.iv,
        pkceVerifierTag: encryptedVerifier.authenticationTag,
        expiresAt: new Date(Date.now() + KeycloakOidcService.ATTEMPT_TTL_MS),
        consumedAt: null,
      }),
    );

    const authorizationUrl = new URL(discovery.authorizationEndpoint);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('client_id', configuration.clientId);
    authorizationUrl.searchParams.set(
      'redirect_uri',
      configuration.redirectUri,
    );
    authorizationUrl.searchParams.set('scope', 'openid email profile');
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('nonce', nonce);
    authorizationUrl.searchParams.set('code_challenge', this.hash(verifier));
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');

    return authorizationUrl.toString();
  }

  async completeAuthorization(
    code: string,
    state: string,
  ): Promise<KeycloakIdentity> {
    if (!this.isBoundedValue(code) || !this.isBoundedValue(state)) {
      this.reject('OIDC_CALLBACK_INVALID');
    }

    const attempt = await this.consumeAttempt(state);
    const configuration = this.getConfiguration();
    const discovery = await this.fetchDiscovery(configuration);
    const verifier = this.attemptCryptoService.decrypt({
      ciphertext: attempt.pkceVerifierCiphertext,
      iv: attempt.pkceVerifierIv,
      authenticationTag: attempt.pkceVerifierTag,
    });
    const tokenResponse = await this.exchangeCode(
      code,
      verifier,
      configuration,
      discovery,
    );
    const payload = await this.verifyIdToken(
      tokenResponse.id_token,
      discovery.jwksUri,
      configuration,
    );

    if (!this.hashMatches(payload.nonce, attempt.nonceHash)) {
      this.reject('OIDC_CALLBACK_INVALID');
    }

    return this.toVerifiedIdentity(payload, configuration);
  }

  private async consumeAttempt(
    state: string,
  ): Promise<OidcAuthorizationAttempt> {
    const stateHash = this.hash(state);
    const attempt = await this.attemptsRepository.findOne({
      where: {
        stateHash,
        consumedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      select: {
        id: true,
        stateHash: true,
        nonceHash: true,
        pkceVerifierCiphertext: true,
        pkceVerifierIv: true,
        pkceVerifierTag: true,
        expiresAt: true,
        consumedAt: true,
      },
    });

    if (
      !attempt ||
      attempt.consumedAt ||
      attempt.expiresAt.getTime() <= Date.now()
    ) {
      this.reject('OIDC_ATTEMPT_INVALID_OR_EXPIRED');
    }

    const consumed = await this.attemptsRepository.update(
      {
        id: attempt.id,
        consumedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      { consumedAt: new Date() },
    );

    if (consumed.affected !== 1) {
      this.reject('OIDC_ATTEMPT_INVALID_OR_EXPIRED');
    }

    return attempt;
  }

  private async exchangeCode(
    code: string,
    verifier: string,
    configuration: OidcConfiguration,
    discovery: Pick<OidcConfiguration, 'tokenEndpoint'>,
  ): Promise<{ id_token: string }> {
    const requestBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: configuration.redirectUri,
      client_id: configuration.clientId,
      code_verifier: verifier,
    });

    if (configuration.clientSecret) {
      requestBody.set('client_secret', configuration.clientSecret);
    }

    const response = await this.fetchJson<unknown>(discovery.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: requestBody.toString(),
    });

    if (!this.isRecord(response) || typeof response.id_token !== 'string') {
      this.reject('OIDC_TOKEN_RESPONSE_INVALID');
    }

    return { id_token: response.id_token };
  }

  private async verifyIdToken(
    token: string,
    jwksUri: string,
    configuration: OidcConfiguration,
  ): Promise<IdTokenPayload> {
    const [encodedHeader, encodedPayload, encodedSignature, ...extra] =
      token.split('.');

    if (
      !encodedHeader ||
      !encodedPayload ||
      !encodedSignature ||
      extra.length > 0
    ) {
      this.reject('OIDC_ID_TOKEN_INVALID');
    }

    const header = this.parseJwtSegment(encodedHeader);
    const payload = this.parseJwtSegment(encodedPayload) as IdTokenPayload;

    if (
      !this.isRecord(header) ||
      header.alg !== 'RS256' ||
      typeof header.kid !== 'string' ||
      header.kid.length > 256
    ) {
      this.reject('OIDC_ID_TOKEN_INVALID');
    }

    const jwks = await this.fetchJson<JwksDocument>(jwksUri);
    const matchingKey = Array.isArray(jwks.keys)
      ? jwks.keys.find(
          (key): key is Jwk =>
            this.isRecord(key) &&
            key.kid === header.kid &&
            key.kty === 'RSA' &&
            (key.use === undefined || key.use === 'sig') &&
            (key.alg === undefined || key.alg === 'RS256'),
        )
      : undefined;

    if (!matchingKey) {
      this.reject('OIDC_ID_TOKEN_INVALID');
    }

    try {
      const verifier = createVerify('RSA-SHA256');
      verifier.update(`${encodedHeader}.${encodedPayload}`);
      verifier.end();

      if (
        !verifier.verify(
          createPublicKey({
            key: matchingKey as unknown as CryptoJsonWebKey,
            format: 'jwk',
          }),
          encodedSignature,
          'base64url',
        )
      ) {
        this.reject('OIDC_ID_TOKEN_INVALID');
      }
    } catch (error) {
      if (error instanceof OidcCallbackRejectedException) {
        throw error;
      }

      this.reject('OIDC_ID_TOKEN_INVALID');
    }

    this.validateTokenClaims(payload, configuration);
    return payload;
  }

  private validateTokenClaims(
    payload: IdTokenPayload,
    configuration: OidcConfiguration,
  ): void {
    const now = Math.floor(Date.now() / 1000);
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];

    if (
      payload.iss !== configuration.issuer ||
      !audience.includes(configuration.clientId) ||
      !this.isNumericDate(payload.exp) ||
      payload.exp < now - 60 ||
      (payload.nbf !== undefined &&
        (!this.isNumericDate(payload.nbf) || payload.nbf > now + 60)) ||
      (Array.isArray(payload.aud) && payload.azp !== configuration.clientId)
    ) {
      this.reject('OIDC_ID_TOKEN_INVALID');
    }
  }

  private toVerifiedIdentity(
    payload: IdTokenPayload,
    configuration: OidcConfiguration,
  ): KeycloakIdentity {
    if (
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0 ||
      payload.sub.length > 255 ||
      typeof payload.email !== 'string' ||
      payload.email_verified !== true
    ) {
      this.reject('OIDC_VERIFIED_EMAIL_REQUIRED');
    }

    const email = payload.email.trim().toLowerCase();
    const [localPart, domain, ...extraParts] = email.split('@');

    if (
      !localPart ||
      !domain ||
      extraParts.length > 0 ||
      !configuration.allowedEmailDomains.includes(domain)
    ) {
      this.reject('OIDC_EMAIL_DOMAIN_NOT_ALLOWED');
    }

    return {
      subject: payload.sub,
      email,
      isWorkCopilotAdmin: this.hasWorkCopilotAdminRole(
        payload,
        configuration.clientId,
      ),
    };
  }

  private hasWorkCopilotAdminRole(
    payload: IdTokenPayload,
    clientId: string,
  ): boolean {
    const realmRoles = this.rolesFrom(
      (payload.realm_access as { roles?: unknown } | undefined)?.roles,
    );
    const resourceAccess = payload.resource_access as
      Record<string, { roles?: unknown }> | undefined;
    const clientRoles = this.rolesFrom(resourceAccess?.[clientId]?.roles);

    return [...realmRoles, ...clientRoles].includes('work-copilot-admin');
  }

  private rolesFrom(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter(
          (role): role is string =>
            typeof role === 'string' && role.length <= 128,
        )
      : [];
  }

  private async fetchDiscovery(
    configuration: OidcConfiguration,
  ): Promise<
    Pick<
      OidcConfiguration,
      'authorizationEndpoint' | 'tokenEndpoint' | 'jwksUri'
    >
  > {
    const discoveryUrl = `${configuration.issuer}/.well-known/openid-configuration`;
    const document = await this.fetchJson<DiscoveryDocument>(discoveryUrl);

    if (
      document.issuer !== configuration.issuer ||
      typeof document.authorization_endpoint !== 'string' ||
      typeof document.token_endpoint !== 'string' ||
      typeof document.jwks_uri !== 'string'
    ) {
      throw new ServiceUnavailableException('OIDC discovery is invalid.');
    }

    return {
      authorizationEndpoint: this.validateProviderUrl(
        document.authorization_endpoint,
      ),
      tokenEndpoint: this.validateProviderUrl(document.token_endpoint),
      jwksUri: this.validateProviderUrl(document.jwks_uri),
    };
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    let response: Response;

    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new ServiceUnavailableException('OIDC provider is unavailable.');
    }

    if (!response.ok) {
      throw new ServiceUnavailableException('OIDC provider is unavailable.');
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new ServiceUnavailableException('OIDC provider is unavailable.');
    }
  }

  private getConfiguration(): OidcConfiguration {
    const issuer = this.normalizeIssuer(
      this.configService.get<string>('KEYCLOAK_ISSUER'),
    );
    const clientId = this.configService
      .get<string>('KEYCLOAK_CLIENT_ID')
      ?.trim();
    const redirectUri = this.configService
      .get<string>('KEYCLOAK_REDIRECT_URI')
      ?.trim();
    const allowedEmailDomains =
      this.configService
        .get<string>('KEYCLOAK_ALLOWED_EMAIL_DOMAINS')
        ?.split(',')
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean) ?? [];

    if (!clientId || !redirectUri || allowedEmailDomains.length === 0) {
      throw new ServiceUnavailableException('OIDC is not configured.');
    }

    return {
      issuer,
      authorizationEndpoint: '',
      tokenEndpoint: '',
      jwksUri: '',
      clientId,
      clientSecret:
        this.configService.get<string>('KEYCLOAK_CLIENT_SECRET') || undefined,
      redirectUri: this.validateRedirectUri(redirectUri),
      allowedEmailDomains,
    };
  }

  private normalizeIssuer(value: string | undefined): string {
    if (!value) {
      throw new ServiceUnavailableException('OIDC is not configured.');
    }

    const issuer = this.validateProviderUrl(value).replace(/\/$/, '');
    return issuer;
  }

  private validateProviderUrl(value: string): string {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      throw new ServiceUnavailableException('OIDC is not configured.');
    }

    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
      throw new ServiceUnavailableException('OIDC is not configured.');
    }

    return url.toString().replace(/\/$/, '');
  }

  private validateRedirectUri(value: string): string {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      throw new ServiceUnavailableException('OIDC is not configured.');
    }

    const isLocalDevelopment =
      url.protocol === 'http:' && url.hostname === 'localhost';

    if (
      (!isLocalDevelopment && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.hash
    ) {
      throw new ServiceUnavailableException('OIDC is not configured.');
    }

    return url.toString();
  }

  private parseJwtSegment(segment: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(segment, 'base64url').toString('utf8'),
      );

      if (!this.isRecord(parsed)) {
        throw new Error('Invalid JWT segment.');
      }

      return parsed;
    } catch {
      throw new UnauthorizedException('OIDC ID token is invalid.');
    }
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('base64url');
  }

  private hashMatches(value: unknown, expectedHash: string): boolean {
    return typeof value === 'string' && this.hash(value) === expectedHash;
  }

  private randomUrlSafeValue(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  private isBoundedValue(value: string): boolean {
    return value.length > 0 && value.length <= 4096;
  }

  private isNumericDate(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private reject(code: OidcRejectionCode): never {
    throw new OidcCallbackRejectedException(code);
  }
}
