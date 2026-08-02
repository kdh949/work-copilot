import { WorkCopilotMetricsService } from './work-copilot-metrics.service';

describe('WorkCopilotMetricsService', () => {
  it('keeps operational labels bounded and never accepts a provider body as a metric label', () => {
    const metrics = new WorkCopilotMetricsService();

    metrics.increment('webhook_intake_total', {
      provider: 'jira',
      outcome: 'accepted',
    });
    metrics.increment('webhook_intake_total', {
      provider: 'issue-description-from-provider' as never,
      outcome: 'accepted',
    });

    const snapshot = metrics.snapshot();
    expect(snapshot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'webhook_intake_total',
          labels: { provider: 'jira', outcome: 'accepted' },
        }),
      ]),
    );
    expect(JSON.stringify(snapshot)).not.toContain(
      'issue-description-from-provider',
    );
  });

  it('reports a bounded AI latency aggregate without request content', () => {
    const metrics = new WorkCopilotMetricsService();
    metrics.observeDuration(
      'work_brief_ai_duration_ms',
      { operation: 'generate', outcome: 'success' },
      42,
    );

    expect(metrics.snapshot()).toContainEqual({
      name: 'work_brief_ai_duration_ms',
      labels: { operation: 'generate', outcome: 'success' },
      count: 1,
      averageDurationMs: 42,
    });
  });
});
