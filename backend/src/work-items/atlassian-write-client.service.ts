import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IntegrationProfileUrlPolicy } from '../integrations/profiles/integration-profile-url.policy';

const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;

export type ProviderWriteResult =
  | { status: 'ok'; body: Record<string, unknown> }
  | { status: 'access_limited' | 'not_found' | 'conflict' | 'rejected' };

/**
 * Narrow write-only counterpart to the read adapter.  It keeps provider URLs,
 * redirects, response bounds and bearer-token handling in one place so a
 * publication gateway never has to issue an unrestricted fetch call.
 */
@Injectable()
export class AtlassianWriteClientService {
  constructor(private readonly urlPolicy: IntegrationProfileUrlPolicy) {}

  async postJson(
    url: URL,
    baseUrl: string,
    accessToken: string,
    body: Record<string, unknown>,
  ): Promise<ProviderWriteResult> {
    return this.writeJson(url, baseUrl, accessToken, 'POST', body);
  }

  async putJson(
    url: URL,
    baseUrl: string,
    accessToken: string,
    body: Record<string, unknown>,
  ): Promise<ProviderWriteResult> {
    return this.writeJson(url, baseUrl, accessToken, 'PUT', body);
  }

  private async writeJson(
    url: URL,
    baseUrl: string,
    accessToken: string,
    method: 'POST' | 'PUT',
    body: Record<string, unknown>,
  ): Promise<ProviderWriteResult> {
    const target = await this.urlPolicy.assertSafeRequestUrl(url, baseUrl);
    let response: Response;

    try {
      response = await fetch(target, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
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
    if (response.status === 409) {
      return { status: 'conflict' };
    }
    if (response.status >= 300 && response.status < 400) {
      throw new BadRequestException('Integration redirect is invalid.');
    }
    if (!response.ok) {
      return { status: 'rejected' };
    }

    return { status: 'ok', body: await this.readJson(response) };
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

    // Several Jira write resources acknowledge a successful mutation with an
    // empty 200/201/204 response.  The caller still validates fields required
    // for its own operation, but an empty success body must not turn a
    // completed provider write into a retryable local failure.
    if (text.trim().length === 0) {
      return {};
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
