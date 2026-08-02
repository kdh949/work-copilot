import { EntityManager, Repository } from 'typeorm';
import { AccountMappingRejectedException } from '../auth/account-mapping-rejected.exception';
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
    ).rejects.toMatchObject<Partial<AccountMappingRejectedException>>({
      diagnosticCode: 'AUTH_ACCOUNT_MAPPED_TO_OTHER_IDENTITY',
    });
  });

  it('provisions a Keycloak-only account for a verified identity without a pilot account', async () => {
    const createdUser = makeLegacyUser({
      id: 8,
      email: 'pilot@example.test',
      nickname: 'pilot',
      password: null,
      department: null,
      employeeNumber: null,
      role: 'employee',
      keycloakSubject: 'keycloak-subject',
      identityProvider: 'keycloak',
      legacyMigratedAt: null,
    });
    const create = jest.fn(() => createdUser);
    const save = jest.fn().mockResolvedValue(createdUser);
    const manager = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce(selectBuilder(null))
        .mockReturnValueOnce(selectBuilder(null)),
      create,
      save,
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
    ).resolves.toMatchObject({
      id: 8,
      email: 'pilot@example.test',
      keycloakSubject: 'keycloak-subject',
    });
    expect(create).toHaveBeenCalledWith(
      User,
      expect.objectContaining({
        email: 'pilot@example.test',
        nickname: 'pilot',
        password: null,
        department: null,
        employeeNumber: null,
        role: 'employee',
        keycloakSubject: 'keycloak-subject',
        identityProvider: 'keycloak',
        legacyMigratedAt: null,
      }),
    );
    expect(save).toHaveBeenCalledWith(createdUser);
  });
});
