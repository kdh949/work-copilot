import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { TransientEvidenceFragment } from './entities/transient-evidence-fragment.entity';
import { TransientEvidenceCryptoService } from './transient-evidence-crypto.service';
import { TransientEvidenceFragmentsService } from './transient-evidence-fragments.service';
import { WorkBriefAiClientService } from './work-brief-ai-client.service';
import { WorkBriefContentGuard } from './work-brief-content-guard.service';
import { WorkBriefsController } from './work-briefs.controller';
import { WorkBriefsService } from './work-briefs.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([TransientEvidenceFragment])],
  controllers: [WorkBriefsController],
  providers: [
    WorkBriefContentGuard,
    TransientEvidenceCryptoService,
    TransientEvidenceFragmentsService,
    WorkBriefAiClientService,
    WorkBriefsService,
  ],
})
export class WorkBriefsModule {}
