import { ConfigService } from '@nestjs/config';
import { IntegrationProfileCryptoService } from './integration-profile-crypto.service';

describe('IntegrationProfileCryptoService', () => {
  it('stores client secrets as AES-GCM ciphertext with a key version', () => {
    const service = new IntegrationProfileCryptoService({
      get: jest.fn((key: string) => {
        if (key === 'INTEGRATION_ENCRYPTION_KEY') {
          return Buffer.alloc(32, 13).toString('base64');
        }

        return '7';
      }),
    } as unknown as ConfigService);

    const encrypted = service.encrypt('jira-client-secret-plaintext');

    expect(encrypted.ciphertext).not.toContain('jira-client-secret-plaintext');
    expect(encrypted.iv.length).toBeGreaterThan(0);
    expect(encrypted.authenticationTag.length).toBeGreaterThan(0);
    expect(encrypted.keyVersion).toBe(7);
    expect(service.decrypt(encrypted)).toBe('jira-client-secret-plaintext');
  });
});
