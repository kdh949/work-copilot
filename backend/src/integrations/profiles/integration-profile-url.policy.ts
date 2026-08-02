import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const LOCAL_HOSTS = new Set(['localhost', 'localhost.localdomain']);

export type IntegrationProvider = 'jira' | 'confluence';

@Injectable()
export class IntegrationProfileUrlPolicy {
  constructor(private readonly configService: ConfigService) {}

  normalizeBaseUrl(value: string): string {
    const url = this.parseHttpsUrl(value, 'Integration base URL is invalid.');
    const host = url.hostname.toLowerCase();

    if (this.isLocalOrIpLiteral(host)) {
      throw new BadRequestException('Integration base URL is invalid.');
    }

    const allowedHosts = this.getAllowedHosts();

    if (allowedHosts.length > 0 && !allowedHosts.includes(host)) {
      throw new BadRequestException('Integration base URL is not allowlisted.');
    }

    if (
      this.configService.get<string>('NODE_ENV') === 'production' &&
      allowedHosts.length === 0
    ) {
      throw new BadRequestException(
        'Integration base URL allowlist is not configured.',
      );
    }

    url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
    return url.toString();
  }

  buildCallbackUrl(provider: IntegrationProvider): string {
    const baseUrl = this.configService.get<string>(
      'INTEGRATION_CALLBACK_BASE_URL',
    );

    if (!baseUrl) {
      throw new BadRequestException(
        'Integration callback URL is not configured.',
      );
    }

    const base = this.parseHttpsUrl(
      baseUrl,
      'Integration callback URL is invalid.',
    );
    const callback = new URL(`integrations/${provider}/callback`, base);

    if (callback.origin !== base.origin) {
      throw new BadRequestException('Integration callback URL is invalid.');
    }

    return callback.toString();
  }

  providerUrl(baseUrl: string, path: string): URL {
    const base = new URL(this.normalizeBaseUrl(baseUrl));
    const url = new URL(path.replace(/^\/+/, ''), base);

    return this.assertProviderRequestUrl(url.toString(), baseUrl);
  }

  assertProviderEndpoint(urlValue: string, baseUrl: string): URL {
    const base = new URL(this.normalizeBaseUrl(baseUrl));
    const url = this.parseHttpsUrl(
      urlValue,
      'Integration provider URL is invalid.',
    );

    return this.assertWithinProviderBase(url, base);
  }

  assertProviderRequestUrl(urlValue: string, baseUrl: string): URL {
    const base = new URL(this.normalizeBaseUrl(baseUrl));
    const url = this.parseHttpsRequestUrl(
      urlValue,
      'Integration provider URL is invalid.',
    );

    return this.assertWithinProviderBase(url, base);
  }

  async assertSafeRequestUrl(url: URL, baseUrl: string): Promise<URL> {
    const safeUrl = this.assertProviderRequestUrl(url.toString(), baseUrl);
    const addresses = await lookup(safeUrl.hostname, {
      all: true,
      verbatim: true,
    });

    if (
      addresses.length === 0 ||
      addresses.some((address) => !this.isPublicAddress(address.address))
    ) {
      throw new BadRequestException(
        'Integration endpoint is not publicly routable.',
      );
    }

    return safeUrl;
  }

  private parseHttpsUrl(value: string, message: string): URL {
    let url: URL;

    try {
      url = new URL(value.trim());
    } catch {
      throw new BadRequestException(message);
    }

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.port && url.port !== '443')
    ) {
      throw new BadRequestException(message);
    }

    return url;
  }

  private parseHttpsRequestUrl(value: string, message: string): URL {
    let url: URL;

    try {
      url = new URL(value.trim());
    } catch {
      throw new BadRequestException(message);
    }

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      (url.port && url.port !== '443')
    ) {
      throw new BadRequestException(message);
    }

    return url;
  }

  private assertWithinProviderBase(url: URL, base: URL): URL {
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
      throw new BadRequestException('Integration provider URL is invalid.');
    }

    return url;
  }

  private getAllowedHosts(): string[] {
    return (
      this.configService
        .get<string>('INTEGRATION_BASE_URL_HOST_ALLOWLIST')
        ?.split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean) ?? []
    );
  }

  private isLocalOrIpLiteral(host: string): boolean {
    if (LOCAL_HOSTS.has(host) || host.endsWith('.localhost')) {
      return true;
    }

    return (
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
      host.includes(':') ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    );
  }

  private isPublicAddress(address: string): boolean {
    const family = isIP(address);

    if (family === 4) {
      const [first, second, third] = address.split('.').map(Number);

      return !(
        first === 0 ||
        first === 10 ||
        first === 127 ||
        first >= 224 ||
        (first === 100 && second >= 64 && second <= 127) ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 0) ||
        (first === 192 && second === 168) ||
        (first === 198 && (second === 18 || second === 19)) ||
        (first === 198 && second === 51 && third === 100) ||
        (first === 203 && second === 0 && third === 113)
      );
    }

    if (family === 6) {
      const normalized = address.toLowerCase();

      if (normalized === '::' || normalized === '::1') {
        return false;
      }

      if (normalized.startsWith('::ffff:')) {
        return this.isPublicAddress(normalized.slice('::ffff:'.length));
      }

      return !(
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        normalized.startsWith('fe8') ||
        normalized.startsWith('fe9') ||
        normalized.startsWith('fea') ||
        normalized.startsWith('feb') ||
        normalized.startsWith('2001:db8')
      );
    }

    return false;
  }
}
