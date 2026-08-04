import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PublicationStep } from './entities/publication-step.entity';

const LEASE_DURATION_MS = 30_000;

@Injectable()
export class PublicationStepClaimerService {
  constructor(
    @InjectRepository(PublicationStep)
    private readonly stepsRepository: Repository<PublicationStep>,
  ) {}

  /**
   * Claims a retryable step with a compare-and-set update. A concurrent
   * request observes `affected === 0` and must not call the provider.
   *
   * An expired lease is deliberately claimable so a terminated process does
   * not leave a publication permanently stuck in RUNNING.
   */
  async claim(stepId: string): Promise<boolean> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);
    const result = await this.stepsRepository
      .createQueryBuilder()
      .update(PublicationStep)
      .set({
        status: 'RUNNING',
        errorCode: null,
        executionLeaseExpiresAt: leaseExpiresAt,
        updatedAt: now,
        attempts: () => '"attempts" + 1',
      })
      .where('"id" = :id', { id: stepId })
      .andWhere(
        '("status" IN (:...claimable) OR ("status" = :running AND "executionLeaseExpiresAt" < :now))',
        {
          claimable: ['PENDING', 'FAILED'],
          running: 'RUNNING',
          now,
        },
      )
      .execute();

    return result.affected === 1;
  }
}
