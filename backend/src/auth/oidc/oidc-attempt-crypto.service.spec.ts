import { ConfigService } from '@nestjs/config';
import { OidcAttemptCryptoService } from './oidc-attempt-crypto.service';

describe('OidcAttemptCryptoService', () => {
  it('round-trips a PKCE verifier without storing it as plaintext', () => {
    const service = new OidcAttemptCryptoService({
      get: jest.fn().mockReturnValue(Buffer.alloc(32, 7).toString('base64')),
    } as unknown as ConfigService);

    const encrypted = service.encrypt('pkce-verifier');

    expect(encrypted.ciphertext).not.toContain('pkce-verifier');
    expect(service.decrypt(encrypted)).toBe('pkce-verifier');
  });
});
