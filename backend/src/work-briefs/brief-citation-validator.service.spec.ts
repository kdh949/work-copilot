import { BadRequestException } from '@nestjs/common';
import { BriefCitationValidatorService } from './brief-citation-validator.service';

const validContent = {
  title: { text: '배포 준비', evidenceIds: ['jira:100'] },
  summary: { text: '배포 전 테스트가 필요합니다.', evidenceIds: ['jira:100'] },
  requirements: [
    { text: '회귀 테스트를 통과합니다.', evidenceIds: ['jira:100'] },
  ],
  acceptanceCriteria: [],
  risks: [],
  nextSteps: [],
  childTasks: [],
};

describe('BriefCitationValidatorService', () => {
  const validator = new BriefCitationValidatorService();

  it('accepts every AI-created item only when it cites selected evidence', () => {
    expect(validator.validate(validContent, new Set(['jira:100']))).toEqual(
      validContent,
    );
  });

  it('rejects a claim with an unknown or empty citation list', () => {
    expect(() =>
      validator.validate(
        {
          ...validContent,
          summary: { text: '근거 없는 요약', evidenceIds: ['jira:999'] },
        },
        new Set(['jira:100']),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      validator.validate(
        {
          ...validContent,
          summary: { text: '근거 없는 요약', evidenceIds: [] },
        },
        new Set(['jira:100']),
      ),
    ).toThrow(BadRequestException);
  });
});
