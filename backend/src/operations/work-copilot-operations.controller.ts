import { Controller, Get, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { WorkCopilotAdminGuard } from '../auth/guards/work-copilot-admin.guard';
import { CleanupHealthService } from './cleanup-health.service';
import { WebhookIntakeHealthService } from './webhook-intake-health.service';
import { WorkCopilotMetricsService } from './work-copilot-metrics.service';

@Controller('admin/work-copilot')
@UseGuards(SessionAuthGuard, WorkCopilotAdminGuard)
export class WorkCopilotOperationsController {
  constructor(
    private readonly cleanupHealth: CleanupHealthService,
    private readonly webhookIntakeHealth: WebhookIntakeHealthService,
    private readonly metrics: WorkCopilotMetricsService,
  ) {}

  @Get('health')
  async health() {
    return {
      webhook: await this.webhookIntakeHealth.snapshot(),
      cleanup: this.cleanupHealth.snapshot(),
      metrics: this.metrics.snapshot(),
    };
  }
}
