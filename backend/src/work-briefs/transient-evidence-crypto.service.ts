import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type EncryptedTransientEvidence = {
  ciphertext: string;
  iv: string;
  authenticationTag: string;
  encryptionKeyVersion: number;
};

@Injectable()
export class TransientEvidenceCryptoService {
  constructor(private readonly configService: ConfigService) {}

  encrypt(value: string): EncryptedTransientEvidence {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.getKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);

    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authenticationTag: cipher.getAuthTag().toString('base64'),
      encryptionKeyVersion: this.getKeyVersion(),
    };
  }

  decrypt(value: EncryptedTransientEvidence): string {
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.getKey(),
        Buffer.from(value.iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(value.authenticationTag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(value.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new InternalServerErrorException(
        'Transient evidence cannot be decrypted.',
      );
    }
  }

  private getKey(): Buffer {
    const value = this.configService.get<string>(
      'TRANSIENT_CONTENT_ENCRYPTION_KEY',
    );
    const key = value ? Buffer.from(value, 'base64') : Buffer.alloc(0);

    if (key.length !== 32) {
      throw new InternalServerErrorException(
        'Transient evidence encryption is not configured.',
      );
    }

    return key;
  }

  private getKeyVersion(): number {
    const value = Number(
      this.configService.get<string>(
        'TRANSIENT_CONTENT_ENCRYPTION_KEY_VERSION',
      ) ?? 1,
    );

    if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
      throw new InternalServerErrorException(
        'Transient evidence encryption is not configured.',
      );
    }

    return value;
  }
}
