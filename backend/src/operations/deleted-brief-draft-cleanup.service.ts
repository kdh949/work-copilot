import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CleanupHealthService } from './cleanup-health.service';
import {
  briefDraftRetentionCutoff,
  briefDraftRetentionDays,
  purgeDeletedBriefDrafts,
} from './deleted-brief-draft-cleanup';

const PURGE_INTERVAL_SECONDS = 60 * 60;

/**
 * Enforces the 90-day retention window on soft-deleted brief drafts.
 *
 * The standalone cleanup cron runs the same purge, but only this in-process
 * timer can report to `CleanupHealthService`. Without the report the job's
 * absence is invisible: a stopped cron would mean not only that nothing is
 * deleted, but that nobody finds out.
 *
 * Most runs delete nothing. That is the normal state and is not a failure.
 */
@Injectable()
export class DeletedBriefDraftCleanupService
  implements OnModuleInit, OnModuleDestroy
{
  private purgeTimer: NodeJS.Timeout | undefined;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly cleanupHealth: CleanupHealthService,
  ) {}

  onModuleInit(): void {
    void this.purgeExpired();
    this.purgeTimer = setInterval(() => {
      void this.purgeExpired();
    }, PURGE_INTERVAL_SECONDS * 1_000);
    this.purgeTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.purgeTimer) {
      clearInterval(this.purgeTimer);
      this.purgeTimer = undefined;
    }
  }

  async purgeExpired(now = new Date()): Promise<void> {
    try {
      const result = await purgeDeletedBriefDrafts(
        this.dataSource,
        briefDraftRetentionCutoff(this.retentionDays(), now),
      );
      this.cleanupHealth.recordSuccess(
        'deleted_brief_drafts',
        result.deletedCount,
        result.skippedCount,
      );
    } catch {
      // Retention runs never surface database errors or brief content.
      this.cleanupHealth.recordFailure('deleted_brief_drafts');
    }
  }

  private retentionDays(): number {
    return briefDraftRetentionDays(
      this.configService.get<string>('WORK_BRIEF_DRAFT_RETENTION_DAYS'),
    );
  }
}
