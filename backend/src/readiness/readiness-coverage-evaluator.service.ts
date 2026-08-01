import { Injectable } from '@nestjs/common';
import type {
  BriefContent,
  EvidenceCitation,
} from '../work-briefs/brief-draft.types';
import type { ReadinessFinding } from './readiness.types';

@Injectable()
export class ReadinessCoverageEvaluatorService {
  evaluate(content: BriefContent): ReadinessFinding[] {
    const selectedChildTasks = content.childTasks.filter(
      (task) => task.selected,
    );

    return content.requirements.flatMap((requirement, requirementIndex) => {
      const missing: Array<'child_task' | 'verification_evidence'> = [];

      if (
        !selectedChildTasks.some((task) =>
          this.sharesEvidence(requirement, task),
        )
      ) {
        missing.push('child_task');
      }
      if (
        !content.acceptanceCriteria.some((criterion) =>
          this.sharesEvidence(requirement, criterion),
        )
      ) {
        missing.push('verification_evidence');
      }

      return missing.length === 0
        ? []
        : [
            {
              code: 'COVERAGE_MISSING' as const,
              severity: 'blocking' as const,
              requirementIndex,
              missing,
              evidenceIds: [...requirement.evidenceIds],
            },
          ];
    });
  }

  private sharesEvidence(
    left: EvidenceCitation,
    right: EvidenceCitation,
  ): boolean {
    const rightIds = new Set(right.evidenceIds);
    return left.evidenceIds.some((evidenceId) => rightIds.has(evidenceId));
  }
}
