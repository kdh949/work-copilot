import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { AtlassianWriteClientService } from './atlassian-write-client.service';

describe('AtlassianWriteClientService', () => {
  const urlPolicy = {
    assertSafeRequestUrl: jest.fn((url: URL) => Promise.resolve(url)),
  };
  const service = new AtlassianWriteClientService(urlPolicy as never);

  afterEach(() => {
    jest.restoreAllMocks();
    urlPolicy.assertSafeRequestUrl.mockClear();
  });

  it('uses an authenticated JSON write and never follows provider redirects', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: '123' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      service.postJson(
        new URL('https://jira.example.test/rest/api/2/issue'),
        'https://jira.example.test/',
        'user-token',
        { fields: {} },
      ),
    ).resolves.toEqual({ status: 'ok', body: { id: '123' } });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
      }),
    );
  });

  it('rejects a redirect instead of forwarding a bearer token', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://unexpected.example.test/' },
      }),
    );

    await expect(
      service.putJson(
        new URL('https://jira.example.test/rest/api/2/issue/1'),
        'https://jira.example.test/',
        'user-token',
        { value: 'safe' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([200, 201, 204])(
    'accepts an empty successful %i response for writes without a body contract',
    async (status) => {
      jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status }),
      );

      await expect(
        service.putJson(
          new URL('https://jira.example.test/rest/api/2/issue/1/properties/key'),
          'https://jira.example.test/',
          'user-token',
          { value: 'safe' },
        ),
      ).resolves.toEqual({ status: 'ok', body: {} });
    },
  );

  it('rejects malformed or oversized successful response bodies', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response('{not-json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('x'.repeat(512 * 1024 + 1), { status: 200 }),
      );

    await expect(
      service.postJson(
        new URL('https://jira.example.test/rest/api/2/issue'),
        'https://jira.example.test/',
        'user-token',
        { fields: {} },
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      service.postJson(
        new URL('https://jira.example.test/rest/api/2/issue'),
        'https://jira.example.test/',
        'user-token',
        { fields: {} },
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
