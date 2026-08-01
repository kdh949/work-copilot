import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IntegrationProfileUrlPolicy } from '../integrations/profiles/integration-profile-url.policy';

const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 5000;

export type ProviderReadResult =
  | { status: 'ok'; body: Record<string, unknown> }
  | { status: 'access_limited' | 'not_found' };

@Injectable()
export class AtlassianReadClientService {
  constructor(private readonly urlPolicy: IntegrationProfileUrlPolicy) {}

  async getJson(
    url: URL,
    baseUrl: string,
    accessToken: string,
  ): Promise<ProviderReadResult> {
    let currentUrl = await this.urlPolicy.assertSafeRequestUrl(url, baseUrl);

    for (let redirectCount = 0; redirectCount < 3; redirectCount += 1) {
      let response: Response;

      try {
        response = await fetch(currentUrl, {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          redirect: 'manual',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        throw new ServiceUnavailableException(
          'Integration endpoint is unavailable.',
        );
      }

      if (response.status === 401 || response.status === 403) {
        return { status: 'access_limited' };
      }

      if (response.status === 404) {
        return { status: 'not_found' };
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');

        if (!location) {
          throw new BadRequestException('Integration redirect is invalid.');
        }

        currentUrl = await this.urlPolicy.assertSafeRequestUrl(
          this.urlPolicy.assertProviderEndpoint(
            new URL(location, currentUrl).toString(),
            baseUrl,
          ),
          baseUrl,
        );
        continue;
      }

      if (!response.ok) {
        throw new ServiceUnavailableException(
          'Integration endpoint is unavailable.',
        );
      }

      return { status: 'ok', body: await this.readJson(response) };
    }

    throw new BadRequestException('Integration redirect is invalid.');
  }

  private async readJson(response: Response): Promise<Record<string, unknown>> {
    const contentLength = Number(response.headers.get('content-length'));

    if (
      Number.isFinite(contentLength) &&
      (contentLength < 0 || contentLength > MAX_RESPONSE_BYTES)
    ) {
      throw new ServiceUnavailableException(
        'Integration response is too large.',
      );
    }

    let text: string;

    try {
      text = await response.text();
    } catch {
      throw new ServiceUnavailableException('Integration response is invalid.');
    }

    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new ServiceUnavailableException(
        'Integration response is too large.',
      );
    }

    try {
      const body: unknown = JSON.parse(text);

      if (!this.isRecord(body)) {
        throw new Error('not a JSON object');
      }

      return body;
    } catch {
      throw new ServiceUnavailableException('Integration response is invalid.');
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
