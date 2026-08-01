import { BadRequestException, ConflictException } from '@nestjs/common';
import { BriefCitationValidatorService } from './brief-citation-validator.service';
import type { BriefContent } from './brief-draft.types';
import type { WorkBriefDraft } from './entities/work-brief-draft.entity';
import { WorkBriefsService } from './work-briefs.service';

const initialContent: BriefContent = {
  title: { text: '배포 준비', evidenceIds: ['jira:100'] },
  summary: { text: '테스트를 진행합니다.', evidenceIds: ['jira:100'] },
  requirements: [
    { text: '회귀 테스트를 실행합니다.', evidenceIds: ['jira:100'] },
  ],
  acceptanceCriteria: [],
  risks: [{ text: '일정 지연', evidenceIds: ['jira:100'] }],
  nextSteps: [{ text: '승인 요청', evidenceIds: ['jira:100'] }],
  childTasks: [],
};

const createDraft = (
  overrides: Partial<WorkBriefDraft> = {},
): WorkBriefDraft => ({
  id: '0e9a46da-cce1-4f35-a0ee-2488f8596391',
  profileId: 'bc4ed2ab-812a-4162-a7a7-e0ea1bd4b48e',
  createdByUserId: 7,
  sourceJiraId: '100',
  sourceJiraKey: 'DEMO-1',
  sourceJiraVersion: '2026-08-02T00:00:00.000Z',
  maskedBrief: initialContent,
  evidence: [
    {
      id: 'jira:100',
      provider: 'jira',
      sourceId: '100',
      url: 'https://jira.example.test/browse/DEMO-1',
      title: '배포 준비',
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
  createdAt: new Date('2026-08-02T00:00:00.000Z'),
  updatedAt: new Date('2026-08-02T00:00:00.000Z'),
  ...overrides,
});

describe('WorkBriefsService', () => {
  const repository = {
    create: jest.fn<WorkBriefDraft, [Partial<WorkBriefDraft>]>(),
    save: jest.fn<Promise<WorkBriefDraft>, [WorkBriefDraft]>(),
    findOneBy: jest.fn<Promise<WorkBriefDraft | null>, [unknown]>(),
    update: jest.fn<
      Promise<{ affected?: number }>,
      [unknown, Partial<WorkBriefDraft>]
    >(),
  };
  const jiraWorkItemService = {
    collectIssueDraftContext: jest.fn(),
  };
  const aiClient = {
    generate: jest.fn(),
    sanitize: jest.fn(),
  };

  function createService(): WorkBriefsService {
    return new WorkBriefsService(
      repository as never,
      jiraWorkItemService as never,
      aiClient as never,
      new BriefCitationValidatorService(),
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findOneBy.mockResolvedValue(null);
  });

  it('creates a masked draft whose every generated item cites real evidence', async () => {
    jiraWorkItemService.collectIssueDraftContext.mockResolvedValue({
      accessStatus: 'accessible',
      profileId: 'bc4ed2ab-812a-4162-a7a7-e0ea1bd4b48e',
      sourceJiraId: '100',
      sourceJiraKey: 'DEMO-1',
      sourceJiraVersion: '2026-08-02T00:00:00.000Z',
      evidence: [
        {
          evidence: createDraft().evidence[0],
          content: 'Jira original evidence must remain transient only.',
        },
      ],
    });
    aiClient.generate.mockResolvedValue({
      title: '배포 준비',
      summary: '테스트를 진행합니다.',
      keyPoints: ['회귀 테스트를 실행합니다.'],
      risks: ['일정 지연'],
      nextSteps: ['승인 요청'],
      evidenceIds: ['jira:100'],
    });
    const stored = createDraft();
    let createdInput: Partial<WorkBriefDraft> | undefined;
    repository.create.mockImplementation((value) => {
      createdInput = value;
      return { ...stored, ...value };
    });
    repository.save.mockResolvedValue(stored);

    const draft = await createService().createDraft(
      7,
      {
        sourceJiraKey: 'DEMO-1',
        selectedEvidenceIds: ['jira:100'],
        instruction: '실행 브리프를 작성하세요.',
      },
      'correlation-id',
    );

    expect(draft.content?.summary.evidenceIds).toEqual(['jira:100']);
    expect(draft.content?.requirements.at(0)?.evidenceIds).toEqual([
      'jira:100',
    ]);
    expect(JSON.stringify(createdInput)).not.toContain(
      'Jira original evidence must remain transient only.',
    );
  });

  it('rejects an optimistic-lock update when another tab has saved first', async () => {
    const current = createDraft({ optimisticVersion: 2 });
    repository.findOneBy.mockResolvedValueOnce(createDraft());
    repository.update.mockResolvedValue({ affected: 0 });
    repository.findOneBy.mockResolvedValueOnce(current);
    aiClient.sanitize.mockResolvedValue([
      initialContent.title.text,
      initialContent.summary.text,
      initialContent.requirements[0].text,
      initialContent.risks[0].text,
      initialContent.nextSteps[0].text,
    ]);

    await expect(
      createService().updateDraft(7, current.id, {
        optimisticVersion: 1,
        content: initialContent,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({ optimisticVersion: 1 }),
      expect.objectContaining({ optimisticVersion: 2 }),
    );
  });

  it('does not call AI when a draft already exists for the selected source', async () => {
    const existing = createDraft();
    jiraWorkItemService.collectIssueDraftContext.mockResolvedValue({
      accessStatus: 'accessible',
      profileId: existing.profileId,
      sourceJiraId: existing.sourceJiraId,
      sourceJiraKey: existing.sourceJiraKey,
      sourceJiraVersion: existing.sourceJiraVersion,
      evidence: [
        {
          evidence: existing.evidence[0],
          content: 'transient source content',
        },
      ],
    });
    repository.findOneBy.mockResolvedValue(existing);

    await expect(
      createService().createDraft(
        existing.createdByUserId,
        {
          sourceJiraKey: existing.sourceJiraKey,
          selectedEvidenceIds: [existing.evidence[0].id],
          instruction: '실행 브리프를 작성하세요.',
        },
        'correlation-id',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(aiClient.generate).not.toHaveBeenCalled();
  });

  it('marks a draft for re-review when a selected source version changes', async () => {
    const current = createDraft();
    repository.findOneBy.mockResolvedValue(current);
    jiraWorkItemService.collectIssueDraftContext.mockResolvedValue({
      accessStatus: 'accessible',
      profileId: current.profileId,
      sourceJiraId: '100',
      sourceJiraKey: 'DEMO-1',
      sourceJiraVersion: '2026-08-03T00:00:00.000Z',
      evidence: [
        {
          evidence: {
            ...current.evidence[0],
            version: '2026-08-03T00:00:00.000Z',
          },
          content: 'new transient evidence',
        },
      ],
    });
    repository.update.mockImplementation((_where, values) => {
      Object.assign(current, values);
      return Promise.resolve({ affected: 1 });
    });

    const refreshed = await createService().refreshDraft(
      7,
      current.id,
      { optimisticVersion: 1 },
      'correlation-id',
    );

    expect(refreshed.freshnessStatus).toBe('review_required');
    expect(refreshed.blockers).toEqual([{ code: 'SOURCE_REVIEW_REQUIRED' }]);
    expect(repository.update).toHaveBeenCalled();
  });

  it('hides prior content when the user no longer has source access', async () => {
    const current = createDraft();
    repository.findOneBy.mockResolvedValue(current);
    jiraWorkItemService.collectIssueDraftContext.mockResolvedValue({
      accessStatus: 'access_limited',
      profileId: null,
      sourceJiraId: null,
      sourceJiraKey: current.sourceJiraKey,
      sourceJiraVersion: null,
      evidence: [],
    });
    repository.update.mockImplementation((_where, values) => {
      Object.assign(current, values);
      return Promise.resolve({ affected: 1 });
    });

    const refreshed = await createService().refreshDraft(
      7,
      current.id,
      { optimisticVersion: 1 },
      'correlation-id',
    );

    expect(refreshed.content).toBeNull();
    expect(refreshed.evidence).toEqual([]);
    expect(refreshed.blockers).toEqual([{ code: 'ACCESS_CHANGED' }]);
  });

  it('does not persist an edit when DLP rejects sensitive content', async () => {
    const current = createDraft();
    repository.findOneBy.mockResolvedValue(current);
    aiClient.sanitize.mockRejectedValue(
      new BadRequestException('Sensitive content cannot be processed.'),
    );

    await expect(
      createService().updateDraft(7, current.id, {
        optimisticVersion: 1,
        content: initialContent,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });
});
