import type { BriefContent } from '../work-briefs/brief-draft.types';
import { ReadinessCoverageEvaluatorService } from './readiness-coverage-evaluator.service';

const content: BriefContent = {
  title: { text: '배포 준비', evidenceIds: ['jira:100'] },
  summary: { text: '테스트를 진행합니다.', evidenceIds: ['jira:100'] },
  requirements: [{ text: '회귀 테스트', evidenceIds: ['jira:100'] }],
  acceptanceCriteria: [{ text: '테스트 결과 확인', evidenceIds: ['jira:100'] }],
  risks: [],
  nextSteps: [],
  childTasks: [
    {
      text: '테스트 작업',
      evidenceIds: ['jira:100'],
      clientTaskId: '0e9a46da-cce1-4f35-a0ee-2488f8596391',
      summary: '회귀 테스트 실행',
      selected: true,
    },
  ],
};

describe('ReadinessCoverageEvaluatorService', () => {
  const evaluator = new ReadinessCoverageEvaluatorService();

  it('accepts a requirement only when selected work and verification share its evidence', () => {
    expect(evaluator.evaluate(content)).toEqual([]);
  });

  it('reports COVERAGE_MISSING when work or verification evidence is disconnected', () => {
    expect(
      evaluator.evaluate({
        ...content,
        acceptanceCriteria: [],
        childTasks: [{ ...content.childTasks[0], evidenceIds: ['jira:101'] }],
      }),
    ).toEqual([
      {
        code: 'COVERAGE_MISSING',
        severity: 'blocking',
        requirementIndex: 0,
        missing: ['child_task', 'verification_evidence'],
        evidenceIds: ['jira:100'],
      },
    ]);
  });
});
