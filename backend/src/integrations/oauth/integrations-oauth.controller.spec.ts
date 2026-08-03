import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { SessionAuthGuard } from '../../auth/guards/session-auth.guard';
import { ProviderAuthorizationCodeRejectedError } from './atlassian-oauth-client.service';
import { IntegrationsOAuthController } from './integrations-oauth.controller';
import { IntegrationsOAuthService } from './integrations-oauth.service';

describe('IntegrationsOAuthController', () => {
  it('requires the BFF session for every user integration endpoint', () => {
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        IntegrationsOAuthController,
      ) as unknown,
    ).toEqual([SessionAuthGuard]);
  });

  it('passes only the authenticated user and correlation ID to the service', async () => {
    const list = jest.fn(() => Promise.resolve([]));
    const controller = new IntegrationsOAuthController(
      { list } as unknown as IntegrationsOAuthService,
      { get: jest.fn() } as unknown as ConfigService,
    );

    await controller.list({
      user: { sub: 42 },
      correlationId: 'corr-42',
    } as never);

    expect(list).toHaveBeenCalledWith(42);
  });

  it('returns the user to the integration page after a successful callback', async () => {
    const completeAuthorization = jest.fn(() => Promise.resolve());
    let redirectedTo = '';
    const redirect = jest.fn((url: string) => {
      redirectedTo = url;
    });
    const controller = new IntegrationsOAuthController(
      { completeAuthorization } as unknown as IntegrationsOAuthService,
      {
        get: jest.fn(() => 'https://work-copilot.example.test'),
      } as unknown as ConfigService,
    );

    await controller.callback(
      'jira',
      { code: 'authorization-code', state: 'state-value' },
      { user: { sub: 42 }, correlationId: 'corr-42' } as never,
      { redirect } as unknown as Response,
    );

    expect(completeAuthorization).toHaveBeenCalledWith(
      'jira',
      'authorization-code',
      'state-value',
      42,
      'corr-42',
    );
    const redirectUrl = new URL(redirectedTo);
    expect(redirectUrl.origin).toBe('https://work-copilot.example.test');
    expect(redirectUrl.searchParams.get('integration')).toBe('jira');
    expect(redirectUrl.searchParams.get('integration_status')).toBe(
      'connected',
    );
  });

  it('returns a safe credential outcome when Jira rejects the client credentials', async () => {
    const completeAuthorization = jest.fn(() =>
      Promise.reject(
        new ProviderAuthorizationCodeRejectedError('invalid_client'),
      ),
    );
    let redirectedTo = '';
    const redirect = jest.fn((url: string) => {
      redirectedTo = url;
    });
    const controller = new IntegrationsOAuthController(
      { completeAuthorization } as unknown as IntegrationsOAuthService,
      {
        get: jest.fn(() => 'https://work-copilot.example.test'),
      } as unknown as ConfigService,
    );

    await controller.callback(
      'jira',
      { code: 'authorization-code', state: 'state-value' },
      { user: { sub: 42 }, correlationId: 'corr-42' } as never,
      { redirect } as unknown as Response,
    );

    const redirectUrl = new URL(redirectedTo);
    expect(redirectUrl.searchParams.get('integration')).toBe('jira');
    expect(redirectUrl.searchParams.get('integration_status')).toBe(
      'configuration_required',
    );
  });

  it.each([
    ['invalid_grant', 'authorization_code_rejected'],
    ['invalid_scope', 'scope_configuration_required'],
    ['invalid_request', 'oauth_request_rejected'],
    ['network_rejected', 'provider_network_rejected'],
    ['unknown', 'token_exchange_failed'],
  ] as const)(
    'returns %s token-exchange feedback without a provider description',
    async (reason, expectedOutcome) => {
      const completeAuthorization = jest.fn(() =>
        Promise.reject(new ProviderAuthorizationCodeRejectedError(reason)),
      );
      let redirectedTo = '';
      const redirect = jest.fn((url: string) => {
        redirectedTo = url;
      });
      const controller = new IntegrationsOAuthController(
        { completeAuthorization } as unknown as IntegrationsOAuthService,
        {
          get: jest.fn(() => 'https://work-copilot.example.test'),
        } as unknown as ConfigService,
      );

      await controller.callback(
        'jira',
        { code: 'authorization-code', state: 'state-value' },
        { user: { sub: 42 }, correlationId: 'corr-42' } as never,
        { redirect } as unknown as Response,
      );

      const redirectUrl = new URL(redirectedTo);
      expect(redirectUrl.searchParams.get('integration_status')).toBe(
        expectedOutcome,
      );
      expect(redirectedTo).not.toContain('authorization-code');
      expect(redirectedTo).not.toContain('state-value');
      expect(redirectedTo).not.toContain('error_description');
    },
  );

  it('does not render provider error descriptions from a rejected consent flow', async () => {
    const completeAuthorization = jest.fn();
    let redirectedTo = '';
    const redirect = jest.fn((url: string) => {
      redirectedTo = url;
    });
    const controller = new IntegrationsOAuthController(
      { completeAuthorization } as unknown as IntegrationsOAuthService,
      {
        get: jest.fn(() => 'https://work-copilot.example.test'),
      } as unknown as ConfigService,
    );

    await controller.callback(
      'confluence',
      {
        error: 'invalid_scope',
        error_description: 'provider-controlled detail must not be shown',
        state: 'state-value',
      },
      { user: { sub: 42 }, correlationId: 'corr-42' } as never,
      { redirect } as unknown as Response,
    );

    expect(completeAuthorization).not.toHaveBeenCalled();
    const redirectUrl = new URL(redirectedTo);
    expect(redirectUrl.searchParams.get('integration')).toBe('confluence');
    expect(redirectUrl.searchParams.get('integration_status')).toBe(
      'provider_rejected',
    );
    expect(redirectedTo).not.toContain('provider-controlled detail');
  });
});
