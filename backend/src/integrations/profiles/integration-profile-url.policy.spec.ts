jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));

import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lookup } from 'node:dns/promises';
import { IntegrationProfileRejectedException } from './integration-profile-rejected.exception';
import { IntegrationProfileUrlPolicy } from './integration-profile-url.policy';

const lookupMock = jest.mocked(lookup);

const makePolicy = (values: Record<string, string | undefined> = {}) =>
  new IntegrationProfileUrlPolicy({
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService);

describe('IntegrationProfileUrlPolicy', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('requires HTTPS, a configured hostname allowlist, and no local address', () => {
    const policy = makePolicy({
      NODE_ENV: 'production',
      INTEGRATION_BASE_URL_HOST_ALLOWLIST:
        'jira.example.test,confluence.example.test',
    });

    expect(policy.normalizeBaseUrl('https://jira.example.test/jira')).toBe(
      'https://jira.example.test/jira/',
    );
    expect(() => policy.normalizeBaseUrl('http://jira.example.test')).toThrow(
      BadRequestException,
    );
    expect(() => policy.normalizeBaseUrl('https://127.0.0.1')).toThrow(
      BadRequestException,
    );
    expect(() =>
      policy.normalizeBaseUrl('https://metadata.google.internal'),
    ).toThrow(BadRequestException);
    expect(() => policy.normalizeBaseUrl('https://other.example.test')).toThrow(
      BadRequestException,
    );
  });

  it('returns a safe reason when the production host allowlist is missing', () => {
    const policy = makePolicy({ NODE_ENV: 'production' });

    expect(() => policy.normalizeBaseUrl('https://jira.example.test')).toThrow(
      IntegrationProfileRejectedException,
    );

    try {
      policy.normalizeBaseUrl('https://jira.example.test');
    } catch (error) {
      expect(error).toMatchObject({
        diagnosticCode:
          'INTEGRATION_PROFILE_BASE_URL_HOST_ALLOWLIST_NOT_CONFIGURED',
      });
    }
  });

  it('rejects discovery endpoints and runtime DNS answers outside the approved public origin', async () => {
    const policy = makePolicy({
      INTEGRATION_BASE_URL_HOST_ALLOWLIST: 'jira.example.test',
    });
    const baseUrl = 'https://jira.example.test';

    expect(() =>
      policy.assertProviderEndpoint(
        'https://attacker.example.test/authorize',
        baseUrl,
      ),
    ).toThrow(BadRequestException);

    lookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    await expect(
      policy.assertSafeRequestUrl(
        new URL('https://jira.example.test/rest/api/2/project/ENG'),
        baseUrl,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    lookupMock.mockResolvedValueOnce([{ address: '203.0.113.10', family: 4 }]);
    await expect(
      policy.assertSafeRequestUrl(
        new URL('https://jira.example.test/rest/api/2/project/ENG'),
        baseUrl,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    lookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);
    await expect(
      policy.assertSafeRequestUrl(
        new URL('https://jira.example.test/rest/api/2/project/ENG'),
        baseUrl,
      ),
    ).resolves.toMatchObject({ hostname: 'jira.example.test' });
  });

  it('allows query strings only for requests inside the configured provider base path', () => {
    const policy = makePolicy({
      INTEGRATION_BASE_URL_HOST_ALLOWLIST: 'jira.example.test',
    });
    const baseUrl = 'https://jira.example.test/jira';

    expect(
      policy
        .providerUrl(baseUrl, 'rest/api/2/issue/ENG-1?fields=summary%2Cproject')
        .toString(),
    ).toBe(
      'https://jira.example.test/jira/rest/api/2/issue/ENG-1?fields=summary%2Cproject',
    );
    expect(() =>
      policy.assertProviderRequestUrl(
        'https://jira.example.test/rest/api/2/issue/ENG-1?fields=summary',
        baseUrl,
      ),
    ).toThrow(BadRequestException);
  });
});
