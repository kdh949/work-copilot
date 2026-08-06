import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { SecurityAuditEvent } from '../integrations/profiles/entities/security-audit-event.entity';
import { BriefPublication } from '../publications/entities/brief-publication.entity';
import { SourceChangeEvent } from '../webhooks/entities/source-change-event.entity';
import { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';
import { CleanupHealthService } from './cleanup-health.service';
import { DeletedBriefDraftCleanupService } from './deleted-brief-draft-cleanup.service';
import { SafeAuditService } from './safe-audit.service';
import { WebhookIngressBoundaryService } from './webhook-ingress-boundary.service';
import { WebhookIntakeHealthService } from './webhook-intake-health.service';
import { WorkCopilotMetricsService } from './work-copilot-metrics.service';
import { WorkCopilotOperationsController } from './work-copilot-operations.controller';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      SecurityAuditEvent,
      SourceChangeEvent,
      WorkBriefDraft,
      BriefPublication,
    ]),
  ],
  controllers: [WorkCopilotOperationsController],
  providers: [
    WorkCopilotMetricsService,
    CleanupHealthService,
    DeletedBriefDraftCleanupService,
    SafeAuditService,
    WebhookIngressBoundaryService,
    WebhookIntakeHealthService,
  ],
  exports: [
    WorkCopilotMetricsService,
    CleanupHealthService,
    SafeAuditService,
    WebhookIngressBoundaryService,
    WebhookIntakeHealthService,
  ],
})
export class OperationsModule {}
