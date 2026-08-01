import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationProfile } from '../integrations/profiles/entities/integration-profile.entity';
import { IntegrationProfilesModule } from '../integrations/profiles/integration-profiles.module';
import { OperationsModule } from '../operations/operations.module';
import { BriefPublication } from '../publications/entities/brief-publication.entity';
import { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';
import { SourceChangeEvent } from './entities/source-change-event.entity';
import { FreshnessReviewService } from './freshness-review.service';
import { WebhookIngestService } from './webhook-ingest.service';
import { WebhookPayloadParserService } from './webhook-payload-parser.service';
import { WorkCopilotWebhooksController } from './work-copilot-webhooks.controller';

@Module({
  imports: [
    OperationsModule,
    IntegrationProfilesModule,
    TypeOrmModule.forFeature([
      IntegrationProfile,
      SourceChangeEvent,
      WorkBriefDraft,
      BriefPublication,
    ]),
  ],
  controllers: [WorkCopilotWebhooksController],
  providers: [
    WebhookPayloadParserService,
    FreshnessReviewService,
    WebhookIngestService,
  ],
})
export class WebhooksModule {}
