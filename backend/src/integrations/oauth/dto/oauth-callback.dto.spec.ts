import { ValidationPipe } from '@nestjs/common';
import { OAuthCallbackDto } from './oauth-callback.dto';

describe('OAuthCallbackDto', () => {
  const transform = (value: Record<string, string>) =>
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }).transform(value, {
      type: 'query',
      metatype: OAuthCallbackDto,
      data: undefined,
    });

  it('accepts a successful authorization-code callback', async () => {
    await expect(
      transform({ code: 'authorization-code', state: 'state-value' }),
    ).resolves.toEqual({ code: 'authorization-code', state: 'state-value' });
  });

  it('accepts a provider error callback without requiring a code', async () => {
    await expect(
      transform({
        error: 'invalid_scope',
        error_description: 'provider controlled detail',
        state: 'state-value',
      }),
    ).resolves.toEqual({
      error: 'invalid_scope',
      error_description: 'provider controlled detail',
      state: 'state-value',
    });
  });
});
