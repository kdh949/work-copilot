import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationsOAuthModule } from '../integrations/oauth/integrations-oauth.module';
import { IntegrationProfile } from '../integrations/profiles/entities/integration-profile.entity';
import { ReadinessModule } from '../readiness/readiness.module';
import { OperationsModule } from '../operations/operations.module';
import { WorkItemsModule } from '../work-items/work-items.module';
import { AtlassianPublicationWriteGateway } from './atlassian-publication-write.gateway';
import { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';
import { BriefPublication } from './entities/brief-publication.entity';
import { PublicationStep } from './entities/publication-step.entity';
import { MockPublicationWriteGateway } from './mock-publication-write.gateway';
import { PublicationService } from './publication.service';
import { PublicationRendererService } from './publication-renderer.service';
import { PUBLICATION_WRITE_GATEWAY } from './publication-write-gateway';

@Module({
  imports: [
    ReadinessModule,
    OperationsModule,
    IntegrationsOAuthModule,
    WorkItemsModule,
    TypeOrmModule.forFeature([
      WorkBriefDraft,
      IntegrationProfile,
      BriefPublication,
      PublicationStep,
    ]),
  ],
  providers: [
    MockPublicationWriteGateway,
    AtlassianPublicationWriteGateway,
    PublicationRendererService,
    {
      provide: PUBLICATION_WRITE_GATEWAY,
      useExisting: MockPublicationWriteGateway,
    },
    PublicationService,
  ],
  exports: [PublicationService],
})
export class PublicationModule {}
