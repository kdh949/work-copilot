import { ValidationPipe } from '@nestjs/common';
import { OidcCallbackDto } from './oidc-callback.dto';

describe('OidcCallbackDto', () => {
  const transform = (value: Record<string, string>) =>
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }).transform(value, {
      type: 'query',
      metatype: OidcCallbackDto,
      data: undefined,
    });

  it('accepts Keycloak callback parameters that are not used for authorization', async () => {
    await expect(
      transform({
        code: 'authorization-code',
        state: 'authorization-state',
        session_state: 'keycloak-session-state',
        iss: 'https://auth.example.test/realms/company',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        code: 'authorization-code',
        state: 'authorization-state',
        session_state: 'keycloak-session-state',
        iss: 'https://auth.example.test/realms/company',
      }),
    );
  });

  it('continues to reject unrelated callback parameters', async () => {
    await expect(
      transform({
        code: 'authorization-code',
        state: 'authorization-state',
        unexpected: 'value',
      }),
    ).rejects.toThrow();
  });
});
