import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { Repository } from 'typeorm';
import { OidcAuthorizationAttempt } from '../entities/oidc-authorization-attempt.entity';
import { OidcAttemptCryptoService } from './oidc-attempt-crypto.service';
import { KeycloakOidcService } from './keycloak-oidc.service';

const ISSUER = 'https://keycloak.example.test/realms/work';
const CLIENT_ID = 'work-copilot-web';

const hash = (value: string): string =>
  createHash('sha256').update(value).digest('base64url');
const encode = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

const jsonResponse = (body: unknown): Response =>
  ({
    ok: true,
    json: () => Promise.resolve(body),
  }) as unknown as Response;

describe('KeycloakOidcService', () => {
  const originalFetch = global.fetch;
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'current-key',
    use: 'sig',
    alg: 'RS256',
  };

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function makeService(overrides?: {
    attempt?: Partial<OidcAuthorizationAttempt> | null;
    affected?: number;
  }) {
    const createAttempt = jest.fn(
      (value: Partial<OidcAuthorizationAttempt>): OidcAuthorizationAttempt =>
        value as OidcAuthorizationAttempt,
    );
    const saveAttempt = jest.fn(
      (value: OidcAuthorizationAttempt): Promise<OidcAuthorizationAttempt> =>
        Promise.resolve(value),
    );
    const findAttempt = jest.fn(
      (): Promise<Partial<OidcAuthorizationAttempt> | null> =>
        Promise.resolve(
          overrides?.attempt === undefined
            ? {
                id: 'attempt-1',
                nonceHash: hash('nonce-1'),
                pkceVerifierCiphertext: 'encrypted',
                pkceVerifierIv: 'iv',
                pkceVerifierTag: 'tag',
                expiresAt: new Date(Date.now() + 60_000),
                consumedAt: null,
              }
            : overrides.attempt,
        ),
    );
    const updateAttempt = jest.fn<
      Promise<{ affected: number }>,
      [unknown, unknown]
    >(() => Promise.resolve({ affected: overrides?.affected ?? 1 }));
    const attemptsRepository = {
      create: createAttempt,
      save: saveAttempt,
      findOne: findAttempt,
      update: updateAttempt,
    };
    const configValues: Record<string, string> = {
      KEYCLOAK_ISSUER: ISSUER,
      KEYCLOAK_CLIENT_ID: CLIENT_ID,
      KEYCLOAK_REDIRECT_URI: 'https://api.example.test/auth/oidc/callback',
      KEYCLOAK_ALLOWED_EMAIL_DOMAINS: 'example.test',
    };
    const config = {
      get: jest.fn((key: string): string | undefined => configValues[key]),
    };
    const crypto = {
      encrypt: jest.fn(() => ({
        ciphertext: 'encrypted',
        iv: 'iv',
        authenticationTag: 'tag',
      })),
      decrypt: jest.fn(() => 'verifier-1'),
    };

    return {
      service: new KeycloakOidcService(
        config as unknown as ConfigService,
        attemptsRepository as unknown as Repository<OidcAuthorizationAttempt>,
        crypto as unknown as OidcAttemptCryptoService,
      ),
      saveAttempt,
      updateAttempt,
    };
  }

  function discoveryResponse() {
    return {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
      token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
      jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
    };
  }

  function signedIdToken(overrides: Record<string, unknown> = {}): string {
    const header = encode({ alg: 'RS256', kid: 'current-key', typ: 'JWT' });
    const payload = encode({
      iss: ISSUER,
      aud: CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 300,
      sub: 'keycloak-subject',
      nonce: 'nonce-1',
      email: 'pilot@example.test',
      email_verified: true,
      realm_access: { roles: ['work-copilot-admin'] },
      ...overrides,
    });
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    signer.end();
    return `${header}.${payload}.${signer.sign(privateKey, 'base64url')}`;
  }

  function mockCallbackFetch(token: string) {
    const fetchMock = jest.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(discoveryResponse()))
      .mockResolvedValueOnce(jsonResponse({ id_token: token }))
      .mockResolvedValueOnce(jsonResponse({ keys: [jwk] }));
    global.fetch = fetchMock;
  }

  it('creates an authorization request with state, nonce, and an S256 PKCE challenge', async () => {
    const { service, saveAttempt } = makeService();
    const fetchMock = jest.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(discoveryResponse()));
    global.fetch = fetchMock;

    const authorizationUrl = new URL(await service.createAuthorizationUrl());
    const state = authorizationUrl.searchParams.get('state');

    expect(authorizationUrl.origin).toBe('https://keycloak.example.test');
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe(
      'S256',
    );
    expect(state).toBeTruthy();
    const savedAttempt = saveAttempt.mock.calls[0]?.[0];
    expect(savedAttempt?.stateHash).toBe(hash(state as string));
    expect(typeof savedAttempt?.nonceHash).toBe('string');
    expect(savedAttempt?.pkceVerifierCiphertext).toBe('encrypted');
  });

  it('consumes state once and validates a signed Keycloak ID token', async () => {
    const { service, updateAttempt } = makeService();
    mockCallbackFetch(signedIdToken());

    await expect(
      service.completeAuthorization('authorization-code', 'state-1'),
    ).resolves.toEqual({
      subject: 'keycloak-subject',
      email: 'pilot@example.test',
      isWorkCopilotAdmin: true,
    });
    const [criteria, update] = updateAttempt.mock.calls[0] ?? [];
    expect(criteria).toEqual(expect.objectContaining({ id: 'attempt-1' }));
    const updateValues = update as { consumedAt?: unknown };
    expect(updateValues.consumedAt).toBeInstanceOf(Date);
  });

  it.each([
    ['issuer', { iss: 'https://attacker.example.test/realm' }],
    ['audience', { aud: 'another-client' }],
    ['nonce', { nonce: 'a-different-nonce' }],
    ['unverified email', { email_verified: false }],
    ['malformed email', { email: 'pilot@example.test@attacker.test' }],
  ])('rejects an ID token with an invalid %s claim', async (_name, claim) => {
    const { service } = makeService();
    mockCallbackFetch(signedIdToken(claim));

    await expect(
      service.completeAuthorization('authorization-code', 'state-1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([
    ['missing', null],
    [
      'expired',
      {
        id: 'attempt-1',
        nonceHash: hash('nonce-1'),
        pkceVerifierCiphertext: 'encrypted',
        pkceVerifierIv: 'iv',
        pkceVerifierTag: 'tag',
        expiresAt: new Date(Date.now() - 1),
        consumedAt: null,
      },
    ],
  ])(
    'rejects a %s state before contacting Keycloak',
    async (_name, attempt) => {
      const { service } = makeService({ attempt });

      await expect(
        service.completeAuthorization('authorization-code', 'state-1'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(global.fetch).toBe(originalFetch);
    },
  );

  it('rejects a reused state before contacting Keycloak', async () => {
    const { service } = makeService({ affected: 0 });

    await expect(
      service.completeAuthorization('authorization-code', 'state-1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(global.fetch).toBe(originalFetch);
  });

  it('fails closed when Keycloak discovery does not match the configured issuer', async () => {
    const { service } = makeService();
    const fetchMock = jest.fn<typeof fetch>();
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...discoveryResponse(),
        issuer: 'https://wrong.example.test',
      }),
    );
    global.fetch = fetchMock;

    await expect(service.createAuthorizationUrl()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
