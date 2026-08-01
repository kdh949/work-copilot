import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { SessionAuthGuard } from '../../auth/guards/session-auth.guard';
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
});
