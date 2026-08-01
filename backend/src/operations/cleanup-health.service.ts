import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkCopilotMetricsService } from './work-copilot-metrics.service';

export type CleanupJob = 'transient_evidence' | 'source_change_events';
export type CleanupJobStatus = 'pending' | 'healthy' | 'degraded';

export type CleanupHealthView = {
  status: CleanupJobStatus;
  maxAgeSeconds: number;
  jobs: Array<{
    job: CleanupJob;
    status: CleanupJobStatus;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastDeletedCount: number;
  }>;
};

type CleanupJobState = {
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastDeletedCount: number;
};

const JOBS: CleanupJob[] = ['transient_evidence', 'source_change_events'];
// The pilot runbook calls for an alert before a missed hourly cleanup job can
// silently exceed the evidence/event retention window.
const DEFAULT_MAX_AGE_SECONDS = 70 * 60;

@Injectable()
export class CleanupHealthService {
  private readonly jobs = new Map<CleanupJob, CleanupJobState>(
    JOBS.map((job) => [
      job,
      { lastAttemptAt: null, lastSuccessAt: null, lastDeletedCount: 0 },
    ]),
  );

  constructor(
    private readonly configService: ConfigService,
    private readonly metrics: WorkCopilotMetricsService,
  ) {}

  recordSuccess(job: CleanupJob, deletedCount: number): void {
    const state = this.stateFor(job);
    const now = new Date();
    state.lastAttemptAt = now;
    state.lastSuccessAt = now;
    state.lastDeletedCount = Math.max(0, Math.floor(deletedCount));
    this.metrics.increment('cleanup_runs_total', { job, outcome: 'success' });
  }

  recordFailure(job: CleanupJob): void {
    this.stateFor(job).lastAttemptAt = new Date();
    this.metrics.increment('cleanup_runs_total', { job, outcome: 'failure' });
  }

  snapshot(now = new Date()): CleanupHealthView {
    const maxAgeSeconds = this.maxAgeSeconds();
    const jobs = JOBS.map((job) => {
      const state = this.stateFor(job);
      const status = this.statusFor(state, now, maxAgeSeconds);
      return {
        job,
        status,
        lastAttemptAt: state.lastAttemptAt?.toISOString() ?? null,
        lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null,
        lastDeletedCount: state.lastDeletedCount,
      };
    });

    return {
      status: jobs.some((job) => job.status === 'degraded')
        ? 'degraded'
        : jobs.some((job) => job.status === 'pending')
          ? 'pending'
          : 'healthy',
      maxAgeSeconds,
      jobs,
    };
  }

  private stateFor(job: CleanupJob): CleanupJobState {
    return this.jobs.get(job) as CleanupJobState;
  }

  private statusFor(
    state: CleanupJobState,
    now: Date,
    maxAgeSeconds: number,
  ): CleanupJobStatus {
    if (!state.lastSuccessAt) {
      return state.lastAttemptAt ? 'degraded' : 'pending';
    }

    return now.getTime() - state.lastSuccessAt.getTime() <=
      maxAgeSeconds * 1_000
      ? 'healthy'
      : 'degraded';
  }

  private maxAgeSeconds(): number {
    const configured = Number(
      this.configService.get<string>('WORK_COPILOT_CLEANUP_MAX_AGE_SECONDS'),
    );

    return Number.isInteger(configured) &&
      configured >= 60 &&
      configured <= 24 * 60 * 60
      ? configured
      : DEFAULT_MAX_AGE_SECONDS;
  }
}
