import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationProfile } from '../integrations/profiles/entities/integration-profile.entity';
import { ReadinessModule } from '../readiness/readiness.module';
import { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';
import { BriefPublication } from './entities/brief-publication.entity';
import { PublicationStep } from './entities/publication-step.entity';
import { MockPublicationWriteGateway } from './mock-publication-write.gateway';
import { PublicationService } from './publication.service';
import { PUBLICATION_WRITE_GATEWAY } from './publication-write-gateway';

@Module({
  imports: [
    ReadinessModule,
    TypeOrmModule.forFeature([
      WorkBriefDraft,
      IntegrationProfile,
      BriefPublication,
      PublicationStep,
    ]),
  ],
  providers: [
    MockPublicationWriteGateway,
    {
      provide: PUBLICATION_WRITE_GATEWAY,
      useExisting: MockPublicationWriteGateway,
    },
    PublicationService,
  ],
  exports: [PublicationService],
})
export class PublicationModule {}
