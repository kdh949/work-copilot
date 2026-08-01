import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { User } from '../../users/user.entity';
import { AuthSession } from '../entities/auth-session.entity';
import { SessionService } from './session.service';

describe('SessionService', () => {
  it('stores only hashes and rotates both the opaque session and CSRF secret', async () => {
    const update = jest.fn().mockReturnThis();
    const set = jest.fn().mockReturnThis();
    const where = jest.fn().mockReturnThis();
    const andWhere = jest.fn().mockReturnThis();
    const execute = jest.fn((): Promise<{ affected: number }> =>
      Promise.resolve({ affected: 1 }),
    );
    const updateBuilder = {
      update,
      set,
      where,
      andWhere,
      execute,
    };
    const createSession = jest.fn(
      (value: Partial<AuthSession>): AuthSession => value as AuthSession,
    );
    const saveSession = jest.fn((value: AuthSession): Promise<AuthSession> =>
      Promise.resolve(value),
    );
    const repository = {
      create: createSession,
      save: saveSession,
      createQueryBuilder: jest.fn().mockReturnValue(updateBuilder),
    } as unknown as Repository<AuthSession>;
    const service = new SessionService(
      { get: jest.fn().mockReturnValue('3600') } as unknown as ConfigService,
      repository,
    );

    const first = await service.create({ id: 3 } as User, false);
    const second = await service.rotate({ id: 'session-1' } as AuthSession);

    const savedSession = saveSession.mock.calls[0]?.[0];
    expect(savedSession?.sessionTokenHash).not.toContain(first.sessionToken);
    expect(savedSession?.csrfSecretHash).not.toContain(first.csrfToken);
    expect(second.sessionToken).not.toBe(first.sessionToken);
    expect(second.csrfToken).not.toBe(first.csrfToken);
    expect(set).toHaveBeenCalledTimes(1);
  });
});
