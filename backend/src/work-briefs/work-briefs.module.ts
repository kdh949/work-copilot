import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { PublicationModule } from '../publications/publication.module';
import { ReadinessModule } from '../readiness/readiness.module';
import { WorkItemsModule } from '../work-items/work-items.module';
import { TransientEvidenceFragment } from './entities/transient-evidence-fragment.entity';
import { WorkBriefDraft } from './entities/work-brief-draft.entity';
import { BriefCitationValidatorService } from './brief-citation-validator.service';
import { TransientEvidenceCryptoService } from './transient-evidence-crypto.service';
import { TransientEvidenceFragmentsService } from './transient-evidence-fragments.service';
import { WorkBriefAiClientService } from './work-brief-ai-client.service';
import { WorkBriefContentGuard } from './work-brief-content-guard.service';
import { WorkBriefsController } from './work-briefs.controller';
import { WorkBriefsService } from './work-briefs.service';

@Module({
  imports: [
    AuthModule,
    WorkItemsModule,
    ReadinessModule,
    PublicationModule,
    TypeOrmModule.forFeature([TransientEvidenceFragment, WorkBriefDraft]),
  ],
  controllers: [WorkBriefsController],
  providers: [
    WorkBriefContentGuard,
    BriefCitationValidatorService,
    TransientEvidenceCryptoService,
    TransientEvidenceFragmentsService,
    WorkBriefAiClientService,
    WorkBriefsService,
  ],
})
export class WorkBriefsModule {}
