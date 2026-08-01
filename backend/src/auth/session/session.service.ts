import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Repository } from 'typeorm';
import { User } from '../../users/user.entity';
import { AuthSession } from '../entities/auth-session.entity';

export const SESSION_COOKIE_NAME = 'work_copilot_session';

export type SessionCredentials = {
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
};

@Injectable()
export class SessionService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(AuthSession)
    private readonly sessionsRepository: Repository<AuthSession>,
  ) {}

  async create(
    user: User,
    isWorkCopilotAdmin: boolean,
  ): Promise<SessionCredentials> {
    const credentials = this.newCredentials();
    const now = new Date();

    await this.sessionsRepository.save(
      this.sessionsRepository.create({
        user,
        userId: user.id,
        sessionTokenHash: this.hash(credentials.sessionToken),
        csrfSecretHash: this.hash(credentials.csrfToken),
        isWorkCopilotAdmin,
        expiresAt: credentials.expiresAt,
        revokedAt: null,
        rotatedAt: now,
      }),
    );

    return credentials;
  }

  async findActive(sessionToken: string): Promise<AuthSession> {
    const session = await this.sessionsRepository
      .createQueryBuilder('session')
      .addSelect(['session.sessionTokenHash', 'session.csrfSecretHash'])
      .leftJoinAndSelect('session.user', 'user')
      .where('session.sessionTokenHash = :sessionTokenHash', {
        sessionTokenHash: this.hash(sessionToken),
      })
      .andWhere('session.revokedAt IS NULL')
      .andWhere('session.expiresAt > :now', { now: new Date() })
      .getOne();

    if (!session) {
      throw new UnauthorizedException();
    }

    return session;
  }

  async rotate(session: AuthSession): Promise<SessionCredentials> {
    const credentials = this.newCredentials();
    const result = await this.sessionsRepository
      .createQueryBuilder()
      .update(AuthSession)
      .set({
        sessionTokenHash: this.hash(credentials.sessionToken),
        csrfSecretHash: this.hash(credentials.csrfToken),
        expiresAt: credentials.expiresAt,
        rotatedAt: new Date(),
      })
      .where('id = :id', { id: session.id })
      .andWhere('revokedAt IS NULL')
      .andWhere('expiresAt > :now', { now: new Date() })
      .execute();

    if (result.affected !== 1) {
      throw new UnauthorizedException();
    }

    return credentials;
  }

  async revoke(session: AuthSession): Promise<void> {
    await this.sessionsRepository
      .createQueryBuilder()
      .update(AuthSession)
      .set({ revokedAt: new Date() })
      .where('id = :id', { id: session.id })
      .andWhere('revokedAt IS NULL')
      .execute();
  }

  hasValidCsrfToken(
    session: AuthSession,
    csrfToken: string | undefined,
  ): boolean {
    if (!csrfToken || csrfToken.length > 512 || !session.csrfSecretHash) {
      return false;
    }

    const actualHash = Buffer.from(this.hash(csrfToken));
    const expectedHash = Buffer.from(session.csrfSecretHash);

    return (
      actualHash.length === expectedHash.length &&
      timingSafeEqual(actualHash, expectedHash)
    );
  }

  private newCredentials(): SessionCredentials {
    const expiresAt = new Date(Date.now() + this.getSessionTtlSeconds() * 1000);

    return {
      sessionToken: randomBytes(32).toString('base64url'),
      csrfToken: randomBytes(32).toString('base64url'),
      expiresAt,
    };
  }

  private getSessionTtlSeconds(): number {
    const configuredTtl = Number(
      this.configService.get<string>('SESSION_TTL_SECONDS') ?? 3600,
    );

    if (
      !Number.isInteger(configuredTtl) ||
      configuredTtl < 300 ||
      configuredTtl > 86_400
    ) {
      throw new UnauthorizedException('Session configuration is invalid.');
    }

    return configuredTtl;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('base64url');
  }
}
