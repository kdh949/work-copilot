import { Injectable } from '@nestjs/common';

export type WorkCopilotMetricName =
  | 'webhook_intake_total'
  | 'webhook_ingress_rejection_total'
  | 'draft_review_required_total'
  | 'cleanup_runs_total'
  | 'work_brief_ai_duration_ms'
  | 'work_brief_dlp_block_total'
  | 'publication_stage_total'
  | 'audit_write_failure_total';

type MetricProvider = 'jira' | 'confluence';
type MetricOutcome =
  | 'accepted'
  | 'replay'
  | 'manual_refresh'
  | 'rejected'
  | 'malformed'
  | 'self_event'
  | 'success'
  | 'failure'
  | 'blocked';
type MetricJob =
  'transient_evidence' | 'source_change_events' | 'deleted_brief_drafts';
type MetricOperation = 'generate' | 'sanitize';
type MetricStage =
  | 'confluence_page'
  | 'jira_remote_link'
  | 'jira_summary_comment'
  | 'jira_child_task';

export type WorkCopilotMetricLabels = {
  provider?: MetricProvider;
  outcome?: MetricOutcome;
  job?: MetricJob;
  operation?: MetricOperation;
  stage?: MetricStage;
};

export type WorkCopilotMetricView = {
  name: WorkCopilotMetricName;
  labels: WorkCopilotMetricLabels;
  count: number;
  averageDurationMs?: number;
};

type MetricAccumulator = {
  name: WorkCopilotMetricName;
  labels: WorkCopilotMetricLabels;
  count: number;
  durationTotalMs: number;
  durationSamples: number;
};

const MAX_DURATION_MS = 10 * 60 * 1_000;
const PROVIDERS = new Set<MetricProvider>(['jira', 'confluence']);
const OUTCOMES = new Set<MetricOutcome>([
  'accepted',
  'replay',
  'manual_refresh',
  'rejected',
  'malformed',
  'self_event',
  'success',
  'failure',
  'blocked',
]);
const JOBS = new Set<MetricJob>([
  'transient_evidence',
  'source_change_events',
  'deleted_brief_drafts',
]);
const OPERATIONS = new Set<MetricOperation>(['generate', 'sanitize']);
const STAGES = new Set<MetricStage>([
  'confluence_page',
  'jira_remote_link',
  'jira_summary_comment',
  'jira_child_task',
]);

@Injectable()
export class WorkCopilotMetricsService {
  private readonly metrics = new Map<string, MetricAccumulator>();

  increment(
    name: WorkCopilotMetricName,
    labels: WorkCopilotMetricLabels = {},
  ): void {
    this.accumulator(name, labels).count += 1;
  }

  observeDuration(
    name: Extract<WorkCopilotMetricName, 'work_brief_ai_duration_ms'>,
    labels: WorkCopilotMetricLabels,
    durationMs: number,
  ): void {
    const accumulator = this.accumulator(name, labels);
    accumulator.count += 1;
    accumulator.durationSamples += 1;
    accumulator.durationTotalMs += Math.max(
      0,
      Math.min(MAX_DURATION_MS, Math.round(durationMs)),
    );
  }

  snapshot(): WorkCopilotMetricView[] {
    return [...this.metrics.values()]
      .sort((left, right) =>
        this.key(left.name, left.labels).localeCompare(
          this.key(right.name, right.labels),
        ),
      )
      .map((metric) => ({
        name: metric.name,
        labels: { ...metric.labels },
        count: metric.count,
        ...(metric.durationSamples > 0
          ? {
              averageDurationMs: Math.round(
                metric.durationTotalMs / metric.durationSamples,
              ),
            }
          : {}),
      }));
  }

  private accumulator(
    name: WorkCopilotMetricName,
    labels: WorkCopilotMetricLabels,
  ): MetricAccumulator {
    const safeLabels = this.safeLabels(labels);
    const key = this.key(name, safeLabels);
    const existing = this.metrics.get(key);

    if (existing) {
      return existing;
    }

    const created: MetricAccumulator = {
      name,
      labels: safeLabels,
      count: 0,
      durationTotalMs: 0,
      durationSamples: 0,
    };
    this.metrics.set(key, created);
    return created;
  }

  private safeLabels(labels: WorkCopilotMetricLabels): WorkCopilotMetricLabels {
    return {
      ...(labels.provider && PROVIDERS.has(labels.provider)
        ? { provider: labels.provider }
        : {}),
      ...(labels.outcome && OUTCOMES.has(labels.outcome)
        ? { outcome: labels.outcome }
        : {}),
      ...(labels.job && JOBS.has(labels.job) ? { job: labels.job } : {}),
      ...(labels.operation && OPERATIONS.has(labels.operation)
        ? { operation: labels.operation }
        : {}),
      ...(labels.stage && STAGES.has(labels.stage)
        ? { stage: labels.stage }
        : {}),
    };
  }

  private key(
    name: WorkCopilotMetricName,
    labels: WorkCopilotMetricLabels,
  ): string {
    return `${name}:${JSON.stringify(labels)}`;
  }
}
