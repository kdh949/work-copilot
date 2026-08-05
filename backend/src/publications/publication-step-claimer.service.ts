import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { PublicationStep } from './entities/publication-step.entity';
import type { PublicationErrorCode } from './publication.types';

export const PUBLICATION_STEP_LEASE_DURATION_MS = 30_000;
export const PUBLICATION_STEP_HEARTBEAT_INTERVAL_MS = 10_000;

export type StepClaim =
  | {
      claimed: true;
      executionToken: string;
      leaseExpiresAt: Date;
      /**
       * True when this claim took over a RUNNING row instead of a cleanly
       * terminated one. The previous worker died while a provider write may
       * have been in flight, so the external outcome is unknown.
       */
      reclaimedInterrupted: boolean;
    }
  | { claimed: false };

export type PublicationStepResult = {
  providerObjectId: string;
  providerObjectVersion?: string;
  providerUrl?: string;
  contentHash?: string;
};

@Injectable()
export class PublicationStepClaimerService {
  constructor(
    @InjectRepository(PublicationStep)
    private readonly stepsRepository: Repository<PublicationStep>,
  ) {}

  /**
   * Claims only PENDING/FAILED work or a RUNNING row whose lease expired.
   * NEEDS_REVIEW is intentionally excluded; it must first pass the separate
   * revision-gated reopen operation.
   *
   * The two states are claimed by two separate conditional updates so the
   * caller learns which one it won. A RUNNING row can only mean a previous
   * execution was interrupted mid-flight, and that fact is not recoverable
   * from the row afterwards because the claim overwrites the status.
   */
  async claim(stepId: string): Promise<StepClaim> {
    const clean = await this.claimWhere(
      stepId,
      '"status" IN (:...claimable)',
      { claimable: ['PENDING', 'FAILED'] },
      false,
    );
    if (clean.claimed) {
      return clean;
    }
    return this.claimWhere(
      stepId,
      '"status" = :running AND ("executionLeaseExpiresAt" IS NULL OR "executionLeaseExpiresAt" < :now)',
      { running: 'RUNNING', now: new Date() },
      true,
    );
  }

  private async claimWhere(
    stepId: string,
    condition: string,
    parameters: Record<string, unknown>,
    reclaimedInterrupted: boolean,
  ): Promise<StepClaim> {
    const now = new Date();
    const leaseExpiresAt = new Date(
      now.getTime() + PUBLICATION_STEP_LEASE_DURATION_MS,
    );
    const executionToken = randomUUID();
    const result = await this.stepsRepository
      .createQueryBuilder()
      .update(PublicationStep)
      .set({
        status: 'RUNNING',
        errorCode: null,
        executionToken,
        executionLeaseExpiresAt: leaseExpiresAt,
        updatedAt: now,
        attempts: () => '"attempts" + 1',
      })
      .where('"id" = :id', { id: stepId })
      .andWhere(`(${condition})`, parameters)
      .returning(['executionToken', 'executionLeaseExpiresAt'])
      .execute();

    if (result.affected !== 1) {
      return { claimed: false };
    }

    const row = this.firstRawRow(result.raw);
    return {
      claimed: true,
      reclaimedInterrupted,
      executionToken:
        this.stringValue(row?.executionToken) ?? executionToken,
      leaseExpiresAt:
        row?.executionLeaseExpiresAt instanceof Date
          ? row.executionLeaseExpiresAt
          : leaseExpiresAt,
    };
  }

  async heartbeat(stepId: string, executionToken: string): Promise<boolean> {
    const now = new Date();
    const leaseExpiresAt = new Date(
      now.getTime() + PUBLICATION_STEP_LEASE_DURATION_MS,
    );
    const result = await this.stepsRepository
      .createQueryBuilder()
      .update(PublicationStep)
      .set({ executionLeaseExpiresAt: leaseExpiresAt, updatedAt: now })
      .where('"id" = :id', { id: stepId })
      .andWhere('"executionToken" = :executionToken', { executionToken })
      .andWhere('"status" = :status', { status: 'RUNNING' })
      .execute();

    return result.affected === 1;
  }

  /** Reopens exactly one NEEDS_REVIEW row for its current fresh preview. */
  async reopenForReview(
    stepId: string,
    approvalRevision: number,
  ): Promise<boolean> {
    const result = await this.stepsRepository
      .createQueryBuilder()
      .update(PublicationStep)
      .set({
        status: 'PENDING',
        errorCode: null,
        executionToken: null,
        executionLeaseExpiresAt: null,
        approvedRevision: approvalRevision,
        updatedAt: new Date(),
      })
      .where('"id" = :id', { id: stepId })
      .andWhere(
        '"status" = :status AND "reviewRevision" = :reviewRevision',
        { status: 'NEEDS_REVIEW', reviewRevision: approvalRevision },
      )
      .andWhere(
        '("approvedRevision" IS NULL OR "approvedRevision" < "reviewRevision")',
      )
      .execute();

    return result.affected === 1;
  }

  /** Fenced terminal success write. */
  async markSucceeded(
    stepId: string,
    executionToken: string,
    result: PublicationStepResult,
  ): Promise<boolean> {
    const update = await this.stepsRepository
      .createQueryBuilder()
      .update(PublicationStep)
      .set({
        status: 'SUCCEEDED',
        providerObjectId: result.providerObjectId,
        providerObjectVersion: result.providerObjectVersion ?? null,
        providerUrl: result.providerUrl ?? null,
        contentHash: result.contentHash ?? null,
        errorCode: null,
        executionToken: null,
        executionLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where('"id" = :id', { id: stepId })
      .andWhere('"executionToken" = :executionToken', { executionToken })
      .execute();

    return update.affected === 1;
  }

  /** Fenced failure write. */
  async markFailed(
    stepId: string,
    executionToken: string,
    status: 'FAILED' | 'NEEDS_REVIEW',
    errorCode: PublicationErrorCode,
  ): Promise<boolean> {
    const update = await this.stepsRepository
      .createQueryBuilder()
      .update(PublicationStep)
      .set({
        status,
        errorCode,
        executionToken: null,
        executionLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where('"id" = :id', { id: stepId })
      .andWhere('"executionToken" = :executionToken', { executionToken })
      .execute();

    return update.affected === 1;
  }

  private firstRawRow(raw: unknown): Record<string, unknown> | null {
    if (!Array.isArray(raw)) {
      return null;
    }
    const row = (raw as unknown[]).at(0);
    return typeof row === 'object' && row !== null
      ? (row as Record<string, unknown>)
      : null;
  }

  private stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
}
