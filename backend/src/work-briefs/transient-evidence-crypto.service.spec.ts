import { InternalServerErrorException } from '@nestjs/common';
import { TransientEvidenceCryptoService } from './transient-evidence-crypto.service';

describe('TransientEvidenceCryptoService', () => {
  const key = Buffer.alloc(32, 7).toString('base64');

  it('round-trips AES-256-GCM evidence without putting plaintext in ciphertext', () => {
    const service = new TransientEvidenceCryptoService({
      get: jest.fn((name: string) => {
        if (name === 'TRANSIENT_CONTENT_ENCRYPTION_KEY') {
          return key;
        }
        return '1';
      }),
    } as never);

    const encrypted = service.encrypt('Jira and Confluence original text');

    expect(encrypted.ciphertext).not.toContain(
      'Jira and Confluence original text',
    );
    expect(service.decrypt(encrypted)).toBe(
      'Jira and Confluence original text',
    );
  });

  it('fails closed when the encryption key is absent or malformed', () => {
    const service = new TransientEvidenceCryptoService({
      get: jest.fn(() => ''),
    } as never);

    expect(() => service.encrypt('evidence')).toThrow(
      InternalServerErrorException,
    );
  });

  it('decrypts the configured previous transient key and requests re-encryption', () => {
    const oldKey = Buffer.alloc(32, 3).toString('base64');
    const currentKey = Buffer.alloc(32, 4).toString('base64');
    const legacy = new TransientEvidenceCryptoService({
      get: jest.fn((name: string) => {
        if (name === 'TRANSIENT_CONTENT_ENCRYPTION_KEY') {
          return oldKey;
        }
        if (name === 'TRANSIENT_CONTENT_ENCRYPTION_KEY_VERSION') {
          return '1';
        }
        return undefined;
      }),
    } as never).encrypt('legacy transient evidence');
    const rotating = new TransientEvidenceCryptoService({
      get: jest.fn((name: string) => {
        const values: Record<string, string> = {
          TRANSIENT_CONTENT_ENCRYPTION_KEY: currentKey,
          TRANSIENT_CONTENT_ENCRYPTION_KEY_VERSION: '2',
          TRANSIENT_CONTENT_ENCRYPTION_PREVIOUS_KEY: oldKey,
          TRANSIENT_CONTENT_ENCRYPTION_PREVIOUS_KEY_VERSION: '1',
        };
        return values[name];
      }),
    } as never);

    expect(rotating.decrypt(legacy)).toBe('legacy transient evidence');
    expect(rotating.needsReencryption(legacy.encryptionKeyVersion)).toBe(true);
    expect(
      rotating.encrypt(rotating.decrypt(legacy)).encryptionKeyVersion,
    ).toBe(2);
  });
});
