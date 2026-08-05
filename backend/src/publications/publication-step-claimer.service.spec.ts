import { PublicationStep } from './entities/publication-step.entity';
import { PublicationStepClaimerService } from './publication-step-claimer.service';

describe('PublicationStepClaimerService', () => {
  function createHarness(
    affected: number,
    raw: Array<Record<string, unknown>> = [
      {
        executionToken: 'execution-token-1',
        executionLeaseExpiresAt: new Date('2026-08-05T00:01:00.000Z'),
      },
    ],
  ) {
    const queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected, raw }),
    };
    const repository = {
      createQueryBuilder: jest.fn(() => queryBuilder),
    };

    return {
      service: new PublicationStepClaimerService(repository as never),
      queryBuilder,
    };
  }

  it('atomically claims pending or failed steps and creates a lease', async () => {
    const { service, queryBuilder } = createHarness(1);

    await expect(service.claim('step-1')).resolves.toMatchObject({
      claimed: true,
      executionToken: 'execution-token-1',
      leaseExpiresAt: expect.any(Date),
    });

    expect(queryBuilder.update).toHaveBeenCalledWith(PublicationStep);
    expect(queryBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'RUNNING',
        errorCode: null,
        executionLeaseExpiresAt: expect.any(Date),
        attempts: expect.any(Function),
      }),
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('"status" IN (:...claimable)'),
      expect.objectContaining({ claimable: ['PENDING', 'FAILED'] }),
    );
    expect(queryBuilder.returning).toHaveBeenCalled();
  });

  it('does not grant execution to a concurrent caller', async () => {
    const { service } = createHarness(0);

    await expect(service.claim('step-1')).resolves.toEqual({ claimed: false });
  });

  it('heartbeats only the worker holding the execution token', async () => {
    const { service, queryBuilder } = createHarness(1);

    await expect(service.heartbeat('step-1', 'execution-token-1')).resolves.toBe(
      true,
    );

    expect(queryBuilder.where).toHaveBeenCalledWith('"id" = :id', {
      id: 'step-1',
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '"executionToken" = :executionToken',
      { executionToken: 'execution-token-1' },
    );
  });

  it('reopens only a matching needs-review step for a new approval revision', async () => {
    const { service, queryBuilder } = createHarness(1);

    await expect(service.reopenForReview('step-1', 4)).resolves.toBe(true);

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '"status" = :status AND "reviewRevision" = :reviewRevision',
      { status: 'NEEDS_REVIEW', reviewRevision: 4 },
    );
    expect(queryBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({ approvedRevision: 4 }),
    );
  });

  it('reports a lost fencing token when terminal persistence affects no row', async () => {
    const { service, queryBuilder } = createHarness(0);

    await expect(
      service.markSucceeded('step-1', 'stale-token', {
        providerObjectId: 'provider-1',
      }),
    ).resolves.toBe(false);
    await expect(
      service.markFailed(
        'step-1',
        'stale-token',
        'FAILED',
        'CONFLUENCE_WRITE_FAILED',
      ),
    ).resolves.toBe(false);

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '"executionToken" = :executionToken',
      { executionToken: 'stale-token' },
    );
  });
});
