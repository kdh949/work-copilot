import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkItemsModule } from '../work-items/work-items.module';
import { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';
import { ReadinessCoverageEvaluatorService } from './readiness-coverage-evaluator.service';
import { ReadinessAssessment } from './entities/readiness-assessment.entity';
import { ReadinessService } from './readiness.service';

@Module({
  imports: [
    WorkItemsModule,
    TypeOrmModule.forFeature([WorkBriefDraft, ReadinessAssessment]),
  ],
  providers: [ReadinessCoverageEvaluatorService, ReadinessService],
  exports: [ReadinessService],
})
export class ReadinessModule {}
