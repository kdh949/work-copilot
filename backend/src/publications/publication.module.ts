import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { PublicationPreviewService } from './publication-preview.service';
import { PublicationStepClaimerService } from './publication-step-claimer.service';
import { PUBLICATION_WRITE_GATEWAY } from './publication-write-gateway';

export function publicationWriteMode(
  configured: string | undefined,
  oauthContractVerified = false,
): 'mock' | 'real' {
  if (configured === undefined) {
    return 'mock';
  }
  const normalized = configured.trim().toLowerCase();
  if (normalized === 'mock' || normalized === 'real') {
    if (normalized === 'real' && !oauthContractVerified) {
      throw new Error(
        'PUBLICATION_WRITE_MODE=real requires a verified Atlassian OAuth2 staging contract.',
      );
    }
    return normalized;
  }
  throw new Error('PUBLICATION_WRITE_MODE must be either "mock" or "real".');
}

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
    PublicationPreviewService,
    PublicationStepClaimerService,
    {
      provide: PUBLICATION_WRITE_GATEWAY,
      inject: [
        ConfigService,
        MockPublicationWriteGateway,
        AtlassianPublicationWriteGateway,
      ],
      useFactory: (
        configService: ConfigService,
        mockGateway: MockPublicationWriteGateway,
        realGateway: AtlassianPublicationWriteGateway,
      ) =>
        publicationWriteMode(
          configService.get<string>('PUBLICATION_WRITE_MODE'),
          configService.get<string>('PUBLICATION_ATLASSIAN_OAUTH_CONTRACT') ===
            'verified',
        ) === 'mock'
          ? mockGateway
          : realGateway,
    },
    PublicationService,
  ],
  exports: [PublicationService],
})
export class PublicationModule {}
