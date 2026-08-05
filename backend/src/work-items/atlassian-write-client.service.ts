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
  | { status: 'ok_empty' }
  /**
   * `rejected` is a definitive refusal by the provider (4xx): the object was
   * not created. `unavailable` is a 5xx, which the provider may have returned
   * after the write already landed, so callers must treat it as ambiguous.
   */
  | {
      status:
        | 'access_limited'
        | 'not_found'
        | 'conflict'
        | 'rejected'
        | 'unavailable';
    };

/**
 * Narrow write-only counterpart to the read adapter.  It keeps provider URLs,
 * redirects, response bounds and bearer-token handling in one place so a
 * publication gateway never has to issue an unrestricted fetch call.
 */
@Injectable()
export class AtlassianWriteClientService {
  constructor(private readonly urlPolicy: IntegrationProfileUrlPolicy) {}

  async postJsonExpectObject(
    url: URL,
    baseUrl: string,
    accessToken: string,
    body: Record<string, unknown>,
  ): Promise<ProviderWriteResult> {
    return this.writeJson(url, baseUrl, accessToken, 'POST', body);
  }

  async postJsonAllowEmpty(
    url: URL,
    baseUrl: string,
    accessToken: string,
    body: Record<string, unknown>,
  ): Promise<ProviderWriteResult> {
    return this.writeJson(url, baseUrl, accessToken, 'POST', body);
  }

  async putJsonExpectObject(
    url: URL,
    baseUrl: string,
    accessToken: string,
    body: Record<string, unknown>,
  ): Promise<ProviderWriteResult> {
    return this.writeJson(url, baseUrl, accessToken, 'PUT', body);
  }

  async putJsonAllowEmpty(
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
    if (response.status >= 500) {
      return { status: 'unavailable' };
    }
    if (!response.ok) {
      return { status: 'rejected' };
    }

    return this.readJson(response);
  }

  private async readJson(response: Response): Promise<ProviderWriteResult> {
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

    if (text.trim().length === 0) {
      return { status: 'ok_empty' };
    }

    try {
      const body: unknown = JSON.parse(text);
      if (!this.isRecord(body)) {
        throw new Error('not a JSON object');
      }
      return { status: 'ok', body };
    } catch {
      throw new ServiceUnavailableException('Integration response is invalid.');
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
