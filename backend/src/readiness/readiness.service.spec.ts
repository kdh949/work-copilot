import { ConflictException } from '@nestjs/common';
import type { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';
import { ReadinessCoverageEvaluatorService } from './readiness-coverage-evaluator.service';
import { ReadinessService } from './readiness.service';

const now = new Date('2026-08-02T00:00:00.000Z');

const createDraft = (
  overrides: Partial<WorkBriefDraft> = {},
): WorkBriefDraft => ({
  id: '0e9a46da-cce1-4f35-a0ee-2488f8596391',
  profileId: 'bc4ed2ab-812a-4162-a7a7-e0ea1bd4b48e',
  createdByUserId: 7,
  sourceJiraId: '100',
  sourceJiraKey: 'ENG-1',
  sourceJiraVersion: '2026-08-02T00:00:00.000Z',
  maskedBrief: {
    title: { text: '배포 준비', evidenceIds: ['jira:100'] },
    summary: { text: '테스트를 진행합니다.', evidenceIds: ['jira:100'] },
    requirements: [{ text: '회귀 테스트', evidenceIds: ['jira:100'] }],
    acceptanceCriteria: [],
    risks: [],
    nextSteps: [],
    childTasks: [
      {
        text: '테스트 작업',
        evidenceIds: ['jira:101'],
        clientTaskId: '0e9a46da-cce1-4f35-a0ee-2488f8596391',
        summary: '회귀 테스트 실행',
        selected: true,
      },
    ],
  },
  evidence: [
    {
      id: 'jira:100',
      provider: 'jira',
      sourceId: '100',
      url: 'https://jira.example.test/browse/ENG-1',
      title: '배포 준비',
      version: '2026-08-02T00:00:00.000Z',
      excerptLength: 80,
      accessStatus: 'accessible',
      dlpStatus: 'not_evaluated',
      aiStatus: 'included',
    },
    {
      id: 'jira:101',
      provider: 'jira',
      sourceId: '101',
      url: 'https://jira.example.test/browse/ENG-2',
      title: '연결 작업',
      version: '2026-08-02T00:00:00.000Z',
      excerptLength: 80,
      accessStatus: 'accessible',
      dlpStatus: 'not_evaluated',
      aiStatus: 'included',
    },
  ],
  status: 'draft',
  freshnessStatus: 'current',
  optimisticVersion: 1,
  policyVersion: 1,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  ...overrides,
});

describe('ReadinessService', () => {
  const draftsRepository = {
    findOneBy: jest.fn(),
  };
  const assessmentsRepository = {
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const jiraWorkItemService = {
    collectReadinessContext: jest.fn(),
  };
  const confluenceWorkItemService = {
    collectEvidenceMetadata: jest.fn(),
  };

  function createService(): ReadinessService {
    return new ReadinessService(
      draftsRepository as never,
      assessmentsRepository as never,
      jiraWorkItemService as never,
      confluenceWorkItemService as never,
      new ReadinessCoverageEvaluatorService(),
    );
  }

  function setupStoredAssessment(): void {
    assessmentsRepository.findOneBy.mockResolvedValue(null);
    assessmentsRepository.create.mockImplementation((value: object) => ({
      id: 'assessment-id',
      createdAt: now,
      updatedAt: now,
      ...value,
    }));
    assessmentsRepository.save.mockImplementation((value) =>
      Promise.resolve({ ...value, updatedAt: now }),
    );
  }

  function accessibleContext() {
    return {
      accessStatus: 'accessible',
      profileId: 'bc4ed2ab-812a-4162-a7a7-e0ea1bd4b48e',
      sourceJiraId: '100',
      sourceJiraKey: 'ENG-1',
      sourceJiraVersion: '2026-08-02T00:00:00.000Z',
      evidenceVersions: [
        { id: 'jira:100', version: '2026-08-02T00:00:00.000Z' },
        { id: 'jira:101', version: '2026-08-02T00:00:00.000Z' },
      ],
      hasAccessLimitedEvidence: false,
      dependencies: [],
      childTaskTemplate: { issueTypeId: '10001', fields: {} },
      createMetadata: {
        status: 'available',
        requiredFieldIds: [
          'project',
          'issuetype',
          'parent',
          'summary',
          'customfield_10100',
        ],
      },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    setupStoredAssessment();
  });

  it('reports exact coverage and Jira mandatory-field finding codes', async () => {
    const draft = createDraft();
    draftsRepository.findOneBy.mockResolvedValue(draft);
    jiraWorkItemService.collectReadinessContext.mockResolvedValue(
      accessibleContext(),
    );

    const result = await createService().assessDraft(7, draft.id, 'corr-1');

    expect(result.status).toBe('BLOCKED');
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'COVERAGE_MISSING' }),
        expect.objectContaining({
          code: 'CREATE_FIELD_MISSING',
          fieldId: 'customfield_10100',
        }),
      ]),
    );
    expect(jiraWorkItemService.collectReadinessContext).toHaveBeenCalledWith(
      7,
      'ENG-1',
      'corr-1',
      true,
    );
  });

  it('returns an identifier-free limited dependency and never persists denied issue data', async () => {
    const draft = createDraft({
      maskedBrief: {
        ...createDraft().maskedBrief,
        acceptanceCriteria: [
          { text: '테스트 결과 확인', evidenceIds: ['jira:100'] },
        ],
        childTasks: [
          {
            ...createDraft().maskedBrief.childTasks[0],
            evidenceIds: ['jira:100'],
          },
        ],
      },
    });
    draftsRepository.findOneBy.mockResolvedValue(draft);
    jiraWorkItemService.collectReadinessContext.mockResolvedValue({
      ...accessibleContext(),
      childTaskTemplate: {
        issueTypeId: '10001',
        fields: { customfield_10100: 'configured' },
      },
      dependencies: [{ kind: 'access_limited' }],
    });

    const result = await createService().assessDraft(7, draft.id, 'corr-2');

    expect(result.status).toBe('ACCESS_LIMITED');
    expect(result.blockers).toEqual([{ kind: 'access_limited' }]);
    expect(JSON.stringify(result)).not.toContain('ENG-2');
    expect(JSON.stringify(assessmentsRepository.save.mock.calls)).not.toContain(
      'ENG-2',
    );
    expect(JSON.stringify(assessmentsRepository.save.mock.calls)).not.toContain(
      'private',
    );
  });

  it('marks a previously selected but no-longer-readable evidence item as access changed', async () => {
    const draft = createDraft({
      maskedBrief: {
        ...createDraft().maskedBrief,
        acceptanceCriteria: [
          { text: '테스트 결과 확인', evidenceIds: ['jira:100'] },
        ],
        childTasks: [
          {
            ...createDraft().maskedBrief.childTasks[0],
            evidenceIds: ['jira:100'],
          },
        ],
      },
    });
    draftsRepository.findOneBy.mockResolvedValue(draft);
    jiraWorkItemService.collectReadinessContext.mockResolvedValue({
      ...accessibleContext(),
      evidenceVersions: [
        { id: 'jira:100', version: '2026-08-02T00:00:00.000Z' },
      ],
      hasAccessLimitedEvidence: true,
      childTaskTemplate: {
        issueTypeId: '10001',
        fields: { customfield_10100: 'configured' },
      },
    });

    const result = await createService().assessDraft(7, draft.id, 'corr-3');

    expect(result.status).toBe('ACCESS_LIMITED');
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ACCESS_CHANGED' }),
      ]),
    );
    expect(result.blockers).toEqual([]);
  });

  it('blocks the publish gate whenever readiness is not READY', async () => {
    const draft = createDraft();
    draftsRepository.findOneBy.mockResolvedValue(draft);
    jiraWorkItemService.collectReadinessContext.mockResolvedValue(
      accessibleContext(),
    );

    await expect(
      createService().assertDraftPublishAllowed(7, draft.id, 'corr-3'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows the publish gate only after coverage, freshness, and required fields pass', async () => {
    const draft = createDraft({
      maskedBrief: {
        ...createDraft().maskedBrief,
        acceptanceCriteria: [
          { text: '테스트 결과 확인', evidenceIds: ['jira:100'] },
        ],
        childTasks: [
          {
            ...createDraft().maskedBrief.childTasks[0],
            evidenceIds: ['jira:100'],
          },
        ],
      },
    });
    draftsRepository.findOneBy.mockResolvedValue(draft);
    jiraWorkItemService.collectReadinessContext.mockResolvedValue({
      ...accessibleContext(),
      childTaskTemplate: {
        issueTypeId: '10001',
        fields: { customfield_10100: 'configured' },
      },
    });

    await expect(
      createService().assertDraftPublishAllowed(7, draft.id, 'corr-4'),
    ).resolves.toBeUndefined();
  });

  it('reports freshness review when a currently readable source version changes', async () => {
    const draft = createDraft({
      maskedBrief: {
        ...createDraft().maskedBrief,
        acceptanceCriteria: [
          { text: '테스트 결과 확인', evidenceIds: ['jira:100'] },
        ],
        childTasks: [
          {
            ...createDraft().maskedBrief.childTasks[0],
            evidenceIds: ['jira:100'],
          },
        ],
      },
    });
    draftsRepository.findOneBy.mockResolvedValue(draft);
    jiraWorkItemService.collectReadinessContext.mockResolvedValue({
      ...accessibleContext(),
      sourceJiraVersion: '2026-08-03T00:00:00.000Z',
      evidenceVersions: [
        { id: 'jira:100', version: '2026-08-03T00:00:00.000Z' },
        { id: 'jira:101', version: '2026-08-02T00:00:00.000Z' },
      ],
      childTaskTemplate: {
        issueTypeId: '10001',
        fields: { customfield_10100: 'configured' },
      },
    });

    const result = await createService().assessDraft(7, draft.id, 'corr-5');

    expect(result.status).toBe('BLOCKED');
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FRESHNESS_REVIEW_REQUIRED' }),
      ]),
    );
    expect(result.publishAllowed).toBe(false);
  });

  it('includes selected Confluence evidence in the read-only freshness gate', async () => {
    const confluenceEvidence = {
      id: 'confluence:200',
      provider: 'confluence' as const,
      sourceId: '200',
      url: 'https://confluence.example.test/pages/viewpage.action?pageId=200',
      title: '배포 결정',
      version: '7',
      excerptLength: 64,
      accessStatus: 'accessible' as const,
      dlpStatus: 'not_evaluated' as const,
      aiStatus: 'included' as const,
    };
    const base = createDraft();
    const draft = createDraft({
      evidence: [...base.evidence, confluenceEvidence],
      maskedBrief: {
        ...base.maskedBrief,
        requirements: [
          { text: '배포 조건 확인', evidenceIds: ['confluence:200'] },
        ],
        acceptanceCriteria: [
          { text: '검증 결과 확인', evidenceIds: ['confluence:200'] },
        ],
        childTasks: [
          {
            ...base.maskedBrief.childTasks[0],
            evidenceIds: ['confluence:200'],
          },
        ],
      },
    });
    draftsRepository.findOneBy.mockResolvedValue(draft);
    jiraWorkItemService.collectReadinessContext.mockResolvedValue({
      ...accessibleContext(),
      childTaskTemplate: {
        issueTypeId: '10001',
        fields: { customfield_10100: 'configured' },
      },
    });
    confluenceWorkItemService.collectEvidenceMetadata.mockResolvedValue({
      accessStatus: 'accessible',
      profileId: draft.profileId,
      evidence: [confluenceEvidence],
    });

    const result = await createService().assessDraft(7, draft.id, 'corr-6');

    expect(result.status).toBe('READY');
    expect(result.publishAllowed).toBe(true);
    expect(confluenceWorkItemService.collectEvidenceMetadata).toHaveBeenCalledWith(
      7,
      ['confluence:200'],
      'corr-6',
    );
  });

  it('does not expose a no-longer-readable Confluence page in readiness results', async () => {
    const base = createDraft();
    const draft = createDraft({
      evidence: [
        ...base.evidence,
        {
          id: 'confluence:200',
          provider: 'confluence',
          sourceId: '200',
          url: 'https://confluence.example.test/pages/viewpage.action?pageId=200',
          title: '비공개 페이지',
          version: '7',
          excerptLength: 64,
          accessStatus: 'accessible',
          dlpStatus: 'not_evaluated',
          aiStatus: 'included',
        },
      ],
    });
    draftsRepository.findOneBy.mockResolvedValue(draft);
    jiraWorkItemService.collectReadinessContext.mockResolvedValue(
      accessibleContext(),
    );
    confluenceWorkItemService.collectEvidenceMetadata.mockResolvedValue({
      accessStatus: 'access_limited',
      profileId: null,
      evidence: [],
    });

    const result = await createService().assessDraft(7, draft.id, 'corr-7');

    expect(result.status).toBe('ACCESS_LIMITED');
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ACCESS_CHANGED' }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('비공개 페이지');
    expect(JSON.stringify(assessmentsRepository.save.mock.calls)).not.toContain(
      '비공개 페이지',
    );
  });
});
