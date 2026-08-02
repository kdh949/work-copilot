import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AccountMappingRejectedException } from '../auth/account-mapping-rejected.exception';
import { User } from './user.entity';

export type KeycloakUserIdentity = {
  subject: string;
  email: string;
};

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email },
    });
  }

  async findById(id: number): Promise<User | null> {
    return this.userRepository.findOne({
      where: { id },
    });
  }

  async findByIdOrFail(id: number): Promise<User> {
    const user = await this.findById(id);

    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    return user;
  }

  async mapVerifiedKeycloakIdentity(
    identity: KeycloakUserIdentity,
  ): Promise<User> {
    return this.userRepository.manager.transaction((manager) =>
      this.mapVerifiedKeycloakIdentityInTransaction(manager, identity),
    );
  }

  private async mapVerifiedKeycloakIdentityInTransaction(
    manager: EntityManager,
    identity: KeycloakUserIdentity,
  ): Promise<User> {
    const bySubject = await manager
      .createQueryBuilder(User, 'user')
      .setLock('pessimistic_write')
      .where('user.keycloakSubject = :subject', { subject: identity.subject })
      .getOne();

    if (bySubject) {
      if (bySubject.email.trim().toLowerCase() !== identity.email) {
        this.reject('AUTH_MAPPED_IDENTITY_EMAIL_MISMATCH');
      }

      return bySubject;
    }

    const legacyUser = await manager
      .createQueryBuilder(User, 'user')
      .setLock('pessimistic_write')
      .where('LOWER(user.email) = :email', { email: identity.email })
      .getOne();

    if (!legacyUser) {
      this.reject('AUTH_PILOT_ACCOUNT_NOT_FOUND');
    }

    if (
      legacyUser.keycloakSubject &&
      legacyUser.keycloakSubject !== identity.subject
    ) {
      this.reject('AUTH_ACCOUNT_MAPPED_TO_OTHER_IDENTITY');
    }

    if (legacyUser.keycloakSubject === identity.subject) {
      return legacyUser;
    }

    const mappingResult = await manager
      .createQueryBuilder()
      .update(User)
      .set({
        keycloakSubject: identity.subject,
        identityProvider: 'keycloak',
        legacyMigratedAt: new Date(),
      })
      .where('id = :id', { id: legacyUser.id })
      .andWhere('keycloakSubject IS NULL')
      .execute();

    if (mappingResult.affected === 1) {
      legacyUser.keycloakSubject = identity.subject;
      legacyUser.identityProvider = 'keycloak';
      legacyUser.legacyMigratedAt = new Date();
      return legacyUser;
    }

    const concurrentlyMappedUser = await manager
      .createQueryBuilder(User, 'user')
      .setLock('pessimistic_write')
      .where('user.id = :id', { id: legacyUser.id })
      .getOne();

    if (concurrentlyMappedUser?.keycloakSubject === identity.subject) {
      return concurrentlyMappedUser;
    }

    this.reject('AUTH_ACCOUNT_MAPPED_TO_OTHER_IDENTITY');
  }

  private reject(
    code: AccountMappingRejectedException['diagnosticCode'],
  ): never {
    throw new AccountMappingRejectedException(code);
  }
}
