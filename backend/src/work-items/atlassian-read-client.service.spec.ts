import { IntegrationProfileUrlPolicy } from '../integrations/profiles/integration-profile-url.policy';
import { AtlassianReadClientService } from './atlassian-read-client.service';

const response = (status: number, body: string): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => String(Buffer.byteLength(body, 'utf8')) },
    text: jest.fn(() => Promise.resolve(body)),
  }) as unknown as Response;

describe('AtlassianReadClientService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('uses the current user token only in the outbound request and does not read a 403 body', async () => {
    const unreadProviderBody = jest.fn<Promise<string>, []>(() =>
      Promise.resolve('provider body must remain unread'),
    );
    const denied = {
      ...response(403, 'provider body must remain unread'),
      text: unreadProviderBody,
    } as unknown as Response;
    const requests: RequestInit[] = [];
    const fetchMock = jest.fn(
      (_url: unknown, init?: RequestInit): Promise<Response> => {
        requests.push(init ?? {});
        return Promise.resolve(denied);
      },
    );
    global.fetch = fetchMock;
    const urlPolicy = {
      assertSafeRequestUrl: jest.fn((url: URL) => Promise.resolve(url)),
      assertProviderEndpoint: jest.fn((value: string) => new URL(value)),
    } as unknown as IntegrationProfileUrlPolicy;
    const client = new AtlassianReadClientService(urlPolicy);

    await expect(
      client.getJson(
        new URL('https://jira.example.test/rest/api/2/issue/ENG-1'),
        'https://jira.example.test/',
        'user-access-token',
      ),
    ).resolves.toEqual({ status: 'access_limited' });

    expect(unreadProviderBody).not.toHaveBeenCalled();
    expect(requests[0]?.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer user-access-token',
    });
  });
});
