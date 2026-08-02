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
});
