import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SourceChangeEvent } from '../webhooks/entities/source-change-event.entity';
import { WebhookIngressBoundaryService } from './webhook-ingress-boundary.service';
import { WorkCopilotMetricsService } from './work-copilot-metrics.service';

export type WebhookIntakeHealthView = {
  mode: 'shadow' | 'manual_refresh';
  ingressVerified: boolean;
  allowedCidrCount: number;
  lastReceivedAt: string | null;
  ingressRejectionCount: number;
};

@Injectable()
export class WebhookIntakeHealthService {
  constructor(
    @InjectRepository(SourceChangeEvent)
    private readonly eventsRepository: Repository<SourceChangeEvent>,
    private readonly ingressBoundary: WebhookIngressBoundaryService,
    private readonly metrics: WorkCopilotMetricsService,
  ) {}

  async snapshot(): Promise<WebhookIntakeHealthView> {
    const lastEvent = await this.eventsRepository.findOne({
      select: { createdAt: true },
      order: { createdAt: 'DESC' },
    });
    const ingressRejectionCount = this.metrics
      .snapshot()
      .filter(
        (metric) =>
          metric.name === 'webhook_ingress_rejection_total' &&
          metric.labels.outcome === 'rejected',
      )
      .reduce((total, metric) => total + metric.count, 0);

    return {
      ...this.ingressBoundary.status(),
      lastReceivedAt: lastEvent?.createdAt.toISOString() ?? null,
      ingressRejectionCount,
    };
  }
}
