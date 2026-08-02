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

  it('reads one configured previous key version and marks it for re-encryption', () => {
    const oldKey = Buffer.alloc(32, 11).toString('base64');
    const currentKey = Buffer.alloc(32, 22).toString('base64');
    const oldService = new IntegrationProfileCryptoService({
      get: jest.fn((key: string) => {
        if (key === 'INTEGRATION_ENCRYPTION_KEY') {
          return oldKey;
        }
        if (key === 'INTEGRATION_ENCRYPTION_KEY_VERSION') {
          return '1';
        }
        return undefined;
      }),
    } as unknown as ConfigService);
    const legacy = oldService.encrypt('legacy-client-secret');
    const rotatingService = new IntegrationProfileCryptoService({
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          INTEGRATION_ENCRYPTION_KEY: currentKey,
          INTEGRATION_ENCRYPTION_KEY_VERSION: '2',
          INTEGRATION_ENCRYPTION_PREVIOUS_KEY: oldKey,
          INTEGRATION_ENCRYPTION_PREVIOUS_KEY_VERSION: '1',
        };
        return values[key];
      }),
    } as unknown as ConfigService);

    expect(rotatingService.decrypt(legacy)).toBe('legacy-client-secret');
    expect(rotatingService.needsReencryption(legacy.keyVersion)).toBe(true);
    expect(rotatingService.encrypt(rotatingService.decrypt(legacy))).toEqual(
      expect.objectContaining({ keyVersion: 2 }),
    );
  });
});
