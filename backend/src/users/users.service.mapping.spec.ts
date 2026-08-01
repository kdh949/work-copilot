import { UnauthorizedException } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';

const makeLegacyUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 4,
    email: 'Pilot@Example.test',
    keycloakSubject: null,
    identityProvider: null,
    legacyMigratedAt: null,
    ...overrides,
  }) as User;

function selectBuilder(result: User | null) {
  return {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result),
  };
}

describe('UsersService.mapVerifiedKeycloakIdentity', () => {
  it('maps an existing pilot account exactly once inside a transaction', async () => {
    const legacyUser = makeLegacyUser();
    const updateBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const manager = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce(selectBuilder(null))
        .mockReturnValueOnce(selectBuilder(legacyUser))
        .mockReturnValueOnce(updateBuilder),
    };
    const transaction = jest.fn(
      (callback: (entityManager: EntityManager) => Promise<User>) =>
        callback(manager as unknown as EntityManager),
    );
    const repository = {
      manager: {
        transaction,
      },
    } as unknown as Repository<User>;
    const service = new UsersService(repository);

    await expect(
      service.mapVerifiedKeycloakIdentity({
        subject: 'keycloak-subject',
        email: 'pilot@example.test',
      }),
    ).resolves.toMatchObject({ keycloakSubject: 'keycloak-subject' });
    expect(transaction).toHaveBeenCalled();
    expect(updateBuilder.andWhere).toHaveBeenCalledWith(
      'keycloakSubject IS NULL',
    );
  });

  it('does not remap an account that is already bound to another subject', async () => {
    const mappedUser = makeLegacyUser({
      keycloakSubject: 'another-subject',
    });
    const manager = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce(selectBuilder(null))
        .mockReturnValueOnce(selectBuilder(mappedUser)),
    };
    const transaction = jest.fn(
      (callback: (entityManager: EntityManager) => Promise<User>) =>
        callback(manager as unknown as EntityManager),
    );
    const repository = {
      manager: {
        transaction,
      },
    } as unknown as Repository<User>;
    const service = new UsersService(repository);

    await expect(
      service.mapVerifiedKeycloakIdentity({
        subject: 'keycloak-subject',
        email: 'pilot@example.test',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
