import { PublicationStep } from './entities/publication-step.entity';
import { PublicationStepClaimerService } from './publication-step-claimer.service';

describe('PublicationStepClaimerService', () => {
  function createHarness(affected: number) {
    const queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected }),
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

    await expect(service.claim('step-1')).resolves.toBe(true);

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
  });

  it('does not grant execution to a concurrent caller', async () => {
    const { service } = createHarness(0);

    await expect(service.claim('step-1')).resolves.toBe(false);
  });
});
