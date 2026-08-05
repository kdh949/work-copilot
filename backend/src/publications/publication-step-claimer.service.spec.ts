import { PublicationStep } from './entities/publication-step.entity';
import { PublicationStepClaimerService } from './publication-step-claimer.service';

describe('PublicationStepClaimerService', () => {
  function createHarness(
    affected: number | number[],
    raw: Array<Record<string, unknown>> = [
      {
        executionToken: 'execution-token-1',
        executionLeaseExpiresAt: new Date('2026-08-05T00:01:00.000Z'),
      },
    ],
  ) {
    // A single number answers every statement; an array answers them in order
    // so a two-phase claim can be driven call by call.
    const results = Array.isArray(affected) ? affected : [affected];
    let call = 0;
    const queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn(() => {
        const result = results[Math.min(call, results.length - 1)];
        call += 1;
        return Promise.resolve({ affected: result, raw });
      }),
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
      reclaimedInterrupted: false,
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
    // Cleanly terminated work must not be confused with an interrupted one,
    // so the expired-lease takeover statement is never reached here.
    expect(queryBuilder.execute).toHaveBeenCalledTimes(1);
    expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(
      expect.stringContaining('"executionLeaseExpiresAt" IS NULL'),
      expect.anything(),
    );
    expect(queryBuilder.returning).toHaveBeenCalled();
  });

  it('reports an expired-lease takeover as an interrupted execution', async () => {
    const { service, queryBuilder } = createHarness([0, 1]);

    await expect(service.claim('step-1')).resolves.toMatchObject({
      claimed: true,
      executionToken: 'execution-token-1',
      reclaimedInterrupted: true,
    });

    expect(queryBuilder.execute).toHaveBeenCalledTimes(2);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('"executionLeaseExpiresAt" IS NULL'),
      expect.objectContaining({ running: 'RUNNING' }),
    );
  });

  it('does not grant execution to a concurrent caller', async () => {
    const { service, queryBuilder } = createHarness(0);

    await expect(service.claim('step-1')).resolves.toEqual({ claimed: false });
    expect(queryBuilder.execute).toHaveBeenCalledTimes(2);
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
