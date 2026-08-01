import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type EncryptedValue = {
  ciphertext: string;
  iv: string;
  authenticationTag: string;
};

@Injectable()
export class OidcAttemptCryptoService {
  constructor(private readonly configService: ConfigService) {}

  encrypt(value: string): EncryptedValue {
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
    };
  }

  decrypt(value: EncryptedValue): string {
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
        'OIDC authorization state cannot be decrypted.',
      );
    }
  }

  private getKey(): Buffer {
    const value = this.configService.get<string>('OIDC_ATTEMPT_ENCRYPTION_KEY');

    if (!value) {
      throw new InternalServerErrorException('OIDC is not configured.');
    }

    const key = Buffer.from(value, 'base64');

    if (key.length !== 32) {
      throw new InternalServerErrorException('OIDC is not configured.');
    }

    return key;
  }
}
