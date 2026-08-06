import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { IsNull } from 'typeorm';
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

/** A schema v2 model output where every item cites only what supports it. */
const aiOutput = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  title: { text: '배포 준비', evidenceIds: ['jira:100'] },
  summary: { text: '테스트를 진행합니다.', evidenceIds: ['jira:100'] },
  keyPoints: [{ text: '회귀 테스트를 실행합니다.', evidenceIds: ['jira:100'] }],
  acceptanceCriteria: [
    { text: '회귀 테스트가 모두 통과한다.', evidenceIds: ['jira:100'] },
  ],
  risks: [{ text: '일정 지연', evidenceIds: ['jira:100'] }],
  nextSteps: [{ text: '승인 요청', evidenceIds: ['jira:100'] }],
  childTasks: [
    {
      summary: '회귀 테스트 실행',
      text: '릴리스 전 회귀 테스트를 실행한다.',
      evidenceIds: ['jira:100'],
    },
  ],
  excludedEvidence: [],
  ...overrides,
});

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
  deletedAt: null,
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
    createQueryBuilder: jest.fn(),
  };
  const jiraWorkItemService = {
    collectIssueDraftContext: jest.fn(),
  };
  const confluenceWorkItemService = {
    collectDraftEvidence: jest.fn(),
    collectEvidenceMetadata: jest.fn(),
  };
  const aiClient = {
    generate: jest.fn(),
    sanitize: jest.fn(),
  };
  const publicationService = {
    findLatestStoredSummaries: jest.fn(),
    assessDraftDeletion: jest.fn(),
  };
  const fragments = { purgeDraft: jest.fn() };
  const audit = { record: jest.fn() };
  const transactionManager = {
    query: jest.fn().mockResolvedValue([]),
    getRepository: jest.fn(() => repository),
  };
  const dataSource = {
    transaction: jest.fn(
      (callback: (manager: typeof transactionManager) => unknown) =>
        Promise.resolve(callback(transactionManager)),
    ),
  };
  // Typed explicitly so the self-referential chaining mocks below do not
  // collapse to `any` and silently weaken every assertion made on them.
  type ListQueryBuilder = {
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    addOrderBy: jest.Mock;
    take: jest.Mock;
    getMany: jest.Mock<Promise<WorkBriefDraft[]>, []>;
  };
  const queryBuilder: ListQueryBuilder = {
    where: jest.fn(() => queryBuilder),
    andWhere: jest.fn(() => queryBuilder),
    orderBy: jest.fn(() => queryBuilder),
    addOrderBy: jest.fn(() => queryBuilder),
    take: jest.fn(() => queryBuilder),
    getMany: jest.fn<Promise<WorkBriefDraft[]>, []>(),
  };

  function createService(): WorkBriefsService {
    return new WorkBriefsService(
      repository as never,
      jiraWorkItemService as never,
      confluenceWorkItemService as never,
      aiClient as never,
      new BriefCitationValidatorService(),
      publicationService as never,
      fragments as never,
      audit as never,
      dataSource as never,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findOneBy.mockResolvedValue(null);
    repository.createQueryBuilder.mockReturnValue(queryBuilder);
    queryBuilder.getMany.mockResolvedValue([]);
    publicationService.findLatestStoredSummaries.mockResolvedValue(new Map());
    publicationService.assessDraftDeletion.mockResolvedValue({
      publishing: false,
      externalWritePerformed: false,
    });
    fragments.purgeDraft.mockResolvedValue(0);
      audit.record.mockResolvedValue(undefined);
      transactionManager.query.mockResolvedValue([]);
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
    aiClient.generate.mockResolvedValue(aiOutput());
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

  it('re-reads selected Confluence evidence in memory before DLP/AI and never persists its raw text', async () => {
    const confluenceEvidence = {
      id: 'confluence:200',
      provider: 'confluence' as const,
      sourceId: '200',
      url: 'https://confluence.example.test/pages/viewpage.action?pageId=200',
      title: '배포 결정',
      version: '7',
      excerptLength: 88,
      accessStatus: 'accessible' as const,
      dlpStatus: 'not_evaluated' as const,
    };
    const jiraEvidence = createDraft().evidence[0];
    const stored = createDraft({
      evidence: [jiraEvidence, { ...confluenceEvidence, aiStatus: 'included' }],
    });
    let createdInput: Partial<WorkBriefDraft> | undefined;
    repository.create.mockImplementation((value) => {
      createdInput = value;
      return { ...stored, ...value };
    });
    repository.save.mockResolvedValue(stored);
    jiraWorkItemService.collectIssueDraftContext.mockResolvedValue({
      accessStatus: 'accessible',
      profileId: stored.profileId,
      sourceJiraId: stored.sourceJiraId,
      sourceJiraKey: stored.sourceJiraKey,
      sourceJiraVersion: stored.sourceJiraVersion,
      evidence: [
        {
          evidence: jiraEvidence,
          content: 'Jira evidence stays transient.',
        },
      ],
    });
    confluenceWorkItemService.collectDraftEvidence.mockResolvedValue({
      accessStatus: 'accessible',
      profileId: stored.profileId,
      evidence: [
        {
          evidence: confluenceEvidence,
          content: 'Confluence original remains in memory only.',
        },
      ],
    });
    aiClient.generate.mockResolvedValue(
      aiOutput({
        summary: {
          text: '테스트를 진행합니다.',
          evidenceIds: ['confluence:200'],
        },
      }),
    );

    await createService().createDraft(
      7,
      {
        sourceJiraKey: stored.sourceJiraKey,
        selectedEvidenceIds: ['jira:100', 'confluence:200'],
        instruction: '실행 브리프를 작성하세요.',
      },
      'correlation-id',
    );

    expect(confluenceWorkItemService.collectDraftEvidence).toHaveBeenCalledWith(
      7,
      ['confluence:200'],
      'correlation-id',
    );
    expect(aiClient.generate).toHaveBeenCalledWith(
      '실행 브리프를 작성하세요.',
      expect.arrayContaining([
        expect.objectContaining({ evidenceId: 'confluence:200' }),
      ]),
    );
    expect(JSON.stringify(createdInput)).not.toContain(
      'Confluence original remains in memory only.',
    );
  });

  it('keeps per-item citations and starts every child task unselected', async () => {
    const stored = createDraft();
    jiraWorkItemService.collectIssueDraftContext.mockResolvedValue({
      accessStatus: 'accessible',
      profileId: stored.profileId,
      sourceJiraId: stored.sourceJiraId,
      sourceJiraKey: stored.sourceJiraKey,
      sourceJiraVersion: stored.sourceJiraVersion,
      evidence: [
        { evidence: stored.evidence[0], content: 'transient evidence' },
        {
          evidence: { ...stored.evidence[0], id: 'jira:101', sourceId: '101' },
          content: 'second transient evidence',
        },
      ],
    });
    aiClient.generate.mockResolvedValue(
      aiOutput({
        acceptanceCriteria: [
          { text: '회귀 테스트가 모두 통과한다.', evidenceIds: ['jira:101'] },
        ],
      }),
    );
    repository.create.mockImplementation((value) => ({ ...stored, ...value }));
    repository.save.mockImplementation((value: WorkBriefDraft) =>
      Promise.resolve(value),
    );

    const draft = await createService().createDraft(
      7,
      {
        sourceJiraKey: stored.sourceJiraKey,
        selectedEvidenceIds: ['jira:100', 'jira:101'],
        instruction: '실행 브리프를 작성하세요.',
      },
      'correlation-id',
    );

    // Items cite what supports them, not the whole evidence list: without
    // this the readiness coverage check passes for free.
    expect(draft.content?.title.evidenceIds).toEqual(['jira:100']);
    expect(draft.content?.acceptanceCriteria.at(0)?.evidenceIds).toEqual([
      'jira:101',
    ]);
    expect(draft.content?.childTasks).toHaveLength(1);
    expect(draft.content?.childTasks.at(0)?.selected).toBe(false);
    expect(draft.content?.childTasks.at(0)?.clientTaskId).toEqual(
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
  });

  it('marks uncited evidence excluded and keeps the model reason', async () => {
    const stored = createDraft();
    const unusedEvidence = {
      ...stored.evidence[0],
      id: 'jira:101',
      sourceId: '101',
    };
    jiraWorkItemService.collectIssueDraftContext.mockResolvedValue({
      accessStatus: 'accessible',
      profileId: stored.profileId,
      sourceJiraId: stored.sourceJiraId,
      sourceJiraKey: stored.sourceJiraKey,
      sourceJiraVersion: stored.sourceJiraVersion,
      evidence: [
        { evidence: stored.evidence[0], content: 'transient evidence' },
        { evidence: unusedEvidence, content: 'unrelated transient evidence' },
      ],
    });
    aiClient.generate.mockResolvedValue(
      aiOutput({
        excludedEvidence: [
          { evidenceId: 'jira:101', reason: '요구사항과 관련이 없습니다.' },
        ],
      }),
    );
    let createdInput: Partial<WorkBriefDraft> | undefined;
    repository.create.mockImplementation((value) => {
      createdInput = value;
      return { ...stored, ...value };
    });
    repository.save.mockImplementation((value: WorkBriefDraft) =>
      Promise.resolve(value),
    );

    const draft = await createService().createDraft(
      7,
      {
        sourceJiraKey: stored.sourceJiraKey,
        selectedEvidenceIds: ['jira:100', 'jira:101'],
        instruction: '실행 브리프를 작성하세요.',
      },
      'correlation-id',
    );

    expect(createdInput?.evidence).toEqual([
      expect.objectContaining({ id: 'jira:100', aiStatus: 'included' }),
      expect.objectContaining({
        id: 'jira:101',
        aiStatus: 'excluded',
        aiExclusionReason: '요구사항과 관련이 없습니다.',
      }),
    ]);
    expect(draft.evidence.at(0)?.aiExclusionReason).toBeUndefined();
  });

  it('masks a child task summary with its own value, not the next task text', async () => {
    const current = createDraft();
    const edited: BriefContent = {
      ...initialContent,
      childTasks: [
        {
          clientTaskId: '8a8c0e4a-0000-4000-8000-000000000001',
          summary: '첫 번째 요약',
          text: '첫 번째 본문',
          evidenceIds: ['jira:100'],
          selected: false,
        },
        {
          clientTaskId: '8a8c0e4a-0000-4000-8000-000000000002',
          summary: '두 번째 요약',
          text: '두 번째 본문',
          evidenceIds: ['jira:100'],
          selected: false,
        },
      ],
    };
    repository.findOneBy.mockResolvedValue(current);
    repository.update.mockImplementation((_where, values) => {
      Object.assign(current, values);
      return Promise.resolve({ affected: 1 });
    });
    // The sanitize contract is order-preserving: citation texts first, then
    // child task summaries.  A shifted index silently swaps user text.
    aiClient.sanitize.mockImplementation((values: string[]) =>
      Promise.resolve(values.map((value) => `${value}(masked)`)),
    );

    const updated = await createService().updateDraft(7, current.id, {
      optimisticVersion: 1,
      content: edited,
    });

    expect(updated.content?.childTasks.at(0)).toEqual(
      expect.objectContaining({
        summary: '첫 번째 요약(masked)',
        text: '첫 번째 본문(masked)',
      }),
    );
    expect(updated.content?.childTasks.at(1)).toEqual(
      expect.objectContaining({
        summary: '두 번째 요약(masked)',
        text: '두 번째 본문(masked)',
      }),
    );
  });

  it('regenerates in place, bumps the version and re-reads the sources', async () => {
    const current = createDraft();
    repository.findOneBy.mockImplementation(() => Promise.resolve(current));
    jiraWorkItemService.collectIssueDraftContext.mockResolvedValue({
      accessStatus: 'accessible',
      profileId: current.profileId,
      sourceJiraId: current.sourceJiraId,
      sourceJiraKey: current.sourceJiraKey,
      sourceJiraVersion: current.sourceJiraVersion,
      evidence: [
        {
          evidence: current.evidence[0],
          content: 'Jira original stays transient on regeneration too.',
        },
      ],
    });
    aiClient.generate.mockResolvedValue(
      aiOutput({
        title: { text: '재작성된 배포 준비', evidenceIds: ['jira:100'] },
      }),
    );
    aiClient.sanitize.mockImplementation((values: string[]) =>
      Promise.resolve(values),
    );
    let updateValues: Partial<WorkBriefDraft> | undefined;
    repository.update.mockImplementation((_where, values) => {
      updateValues = values;
      Object.assign(current, values);
      return Promise.resolve({ affected: 1 });
    });

    const regenerated = await createService().regenerateDraft(
      7,
      current.id,
      { optimisticVersion: 1, instruction: '더 간결하게 작성하세요.' },
      'correlation-id',
    );

    expect(regenerated.content?.title.text).toBe('재작성된 배포 준비');
    expect(regenerated.optimisticVersion).toBe(2);
    expect(regenerated.content?.acceptanceCriteria).toHaveLength(1);
    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({ optimisticVersion: 1, deletedAt: IsNull() }),
      expect.objectContaining({ optimisticVersion: 2 }),
    );
    // Excerpts are never stored, so regeneration re-reads with user OAuth.
    expect(jiraWorkItemService.collectIssueDraftContext).toHaveBeenCalledWith(
      7,
      current.sourceJiraKey,
      'correlation-id',
    );
    expect(JSON.stringify(updateValues)).not.toContain(
      'Jira original stays transient on regeneration too.',
    );
  });

  it.each([
    [
      'a reserved publication',
      { publishing: true, externalWritePerformed: false },
      'PUBLICATION_IN_PROGRESS',
    ],
    [
      'an actual or indeterminate external write',
      { publishing: false, externalWritePerformed: true },
      'DRAFT_HAS_PUBLICATION',
    ],
  ])(
    'does not regenerate a draft with %s',
    async (_label, publicationSafety, code) => {
      const current = createDraft();
      repository.findOneBy.mockResolvedValue(current);
      publicationService.assessDraftDeletion.mockResolvedValue(
        publicationSafety,
      );

      await expect(
        createService().regenerateDraft(
          7,
          current.id,
          { optimisticVersion: 1, instruction: '다시 작성하세요.' },
          'correlation-id',
        ),
      ).rejects.toMatchObject({ response: { code } });

      expect(aiClient.generate).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
      expect(transactionManager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`work-brief-draft:${current.id}`],
      );
    },
  );

  it('blocks regeneration when publication reserves the draft during generation', async () => {
    const current = createDraft();
    repository.findOneBy.mockResolvedValue(current);
    jiraWorkItemService.collectIssueDraftContext.mockResolvedValue({
      accessStatus: 'accessible',
      profileId: current.profileId,
      sourceJiraId: current.sourceJiraId,
      sourceJiraKey: current.sourceJiraKey,
      sourceJiraVersion: current.sourceJiraVersion,
      evidence: [
        { evidence: current.evidence[0], content: 'transient evidence' },
      ],
    });
    aiClient.generate.mockResolvedValue(aiOutput());
    aiClient.sanitize.mockImplementation((values: string[]) =>
      Promise.resolve(values),
    );
    publicationService.assessDraftDeletion
      .mockResolvedValueOnce({
        publishing: false,
        externalWritePerformed: false,
      })
      // Simulates publish reserving PENDING between the short preflight lock
      // and the post-AI persistence lock.
      .mockResolvedValueOnce({
        publishing: true,
        externalWritePerformed: false,
      });

    await expect(
      createService().regenerateDraft(
        7,
        current.id,
        { optimisticVersion: 1, instruction: '다시 작성하세요.' },
        'correlation-id',
      ),
    ).rejects.toMatchObject({
      response: { code: 'PUBLICATION_IN_PROGRESS' },
    });

    expect(publicationService.assessDraftDeletion).toHaveBeenCalledTimes(2);
    expect(transactionManager.query).toHaveBeenCalledTimes(2);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('marks every stored Confluence evidence version change for review before AI', async () => {
    const confluenceEvidence = {
      id: 'confluence:200',
      provider: 'confluence' as const,
      sourceId: '200',
      url: 'https://confluence.example.test/pages/viewpage.action?pageId=200',
      title: '배포 결정',
      version: '5',
      excerptLength: 88,
      accessStatus: 'accessible' as const,
      dlpStatus: 'not_evaluated' as const,
      aiStatus: 'included' as const,
    };
    const current = createDraft({
      evidence: [createDraft().evidence[0], confluenceEvidence],
    });
    repository.findOneBy.mockImplementation(() => Promise.resolve(current));
    repository.update.mockImplementation((_where, values) => {
      Object.assign(current, values);
      return Promise.resolve({ affected: 1 });
    });
    jiraWorkItemService.collectIssueDraftContext.mockResolvedValue({
      accessStatus: 'accessible',
      profileId: current.profileId,
      sourceJiraId: current.sourceJiraId,
      sourceJiraKey: current.sourceJiraKey,
      sourceJiraVersion: current.sourceJiraVersion,
      evidence: [
        { evidence: current.evidence[0], content: 'Jira transient evidence' },
      ],
    });
    confluenceWorkItemService.collectEvidenceMetadata.mockResolvedValue({
      accessStatus: 'accessible',
      profileId: current.profileId,
      evidence: [{ ...confluenceEvidence, version: '6' }],
    });

    await expect(
      createService().regenerateDraft(
        7,
        current.id,
        { optimisticVersion: 1, instruction: '다시 작성하세요.' },
        'correlation-id',
      ),
    ).rejects.toMatchObject({
      response: { code: 'SOURCE_REVIEW_REQUIRED', currentVersion: 2 },
    });

    expect(
      confluenceWorkItemService.collectEvidenceMetadata,
    ).toHaveBeenCalledWith(7, ['confluence:200'], 'correlation-id');
    expect(current.freshnessStatus).toBe('review_required');
    expect(current.evidence).toHaveLength(2);
    expect(aiClient.generate).not.toHaveBeenCalled();
  });

  it('marks Jira and Confluence access loss instead of leaving a current draft', async () => {
    const current = createDraft();
    repository.findOneBy.mockImplementation(() => Promise.resolve(current));
    repository.update.mockImplementation((_where, values) => {
      Object.assign(current, values);
      return Promise.resolve({ affected: 1 });
    });
    jiraWorkItemService.collectIssueDraftContext.mockRejectedValue(
      new ConflictException('Reconnect the integration to continue.'),
    );

    await expect(
      createService().regenerateDraft(
        7,
        current.id,
        { optimisticVersion: 1, instruction: '다시 작성하세요.' },
        'correlation-id',
      ),
    ).rejects.toMatchObject({
      response: { code: 'ACCESS_CHANGED', currentVersion: 2 },
    });
    expect(current.freshnessStatus).toBe('access_changed');
    expect(current.evidence).toEqual([]);

    const confluenceEvidence = {
      ...createDraft().evidence[0],
      id: 'confluence:200',
      provider: 'confluence' as const,
      sourceId: '200',
    };
    const withConfluence = createDraft({
      evidence: [createDraft().evidence[0], confluenceEvidence],
    });
    repository.findOneBy.mockImplementation(() =>
      Promise.resolve(withConfluence),
    );
    repository.update.mockImplementation((_where, values) => {
      Object.assign(withConfluence, values);
      return Promise.resolve({ affected: 1 });
    });
    jiraWorkItemService.collectIssueDraftContext.mockResolvedValue({
      accessStatus: 'accessible',
      profileId: withConfluence.profileId,
      sourceJiraId: withConfluence.sourceJiraId,
      sourceJiraKey: withConfluence.sourceJiraKey,
      sourceJiraVersion: withConfluence.sourceJiraVersion,
      evidence: [
        {
          evidence: withConfluence.evidence[0],
          content: 'Jira transient evidence',
        },
      ],
    });
    confluenceWorkItemService.collectEvidenceMetadata.mockResolvedValue({
      accessStatus: 'access_limited',
      profileId: null,
      evidence: [],
    });

    await expect(
      createService().regenerateDraft(
        7,
        withConfluence.id,
        { optimisticVersion: 1, instruction: '다시 작성하세요.' },
        'correlation-id',
      ),
    ).rejects.toMatchObject({
      response: { code: 'ACCESS_CHANGED', currentVersion: 2 },
    });
    expect(withConfluence.freshnessStatus).toBe('access_changed');
    expect(withConfluence.evidence).toEqual([]);
    expect(aiClient.generate).not.toHaveBeenCalled();
  });

  it('regenerates with a changed evidence selection when one is given', async () => {
    const current = createDraft();
    const extraEvidence = {
      ...current.evidence[0],
      id: 'jira:101',
      sourceId: '101',
    };
    repository.findOneBy.mockImplementation(() => Promise.resolve(current));
    jiraWorkItemService.collectIssueDraftContext.mockResolvedValue({
      accessStatus: 'accessible',
      profileId: current.profileId,
      sourceJiraId: current.sourceJiraId,
      sourceJiraKey: current.sourceJiraKey,
      sourceJiraVersion: current.sourceJiraVersion,
      evidence: [
        { evidence: current.evidence[0], content: 'first transient' },
        { evidence: extraEvidence, content: 'second transient' },
      ],
    });
    aiClient.generate.mockResolvedValue(
      aiOutput({
        summary: { text: '테스트를 진행합니다.', evidenceIds: ['jira:101'] },
      }),
    );
    aiClient.sanitize.mockImplementation((values: string[]) =>
      Promise.resolve(values),
    );
    repository.update.mockImplementation((_where, values) => {
      Object.assign(current, values);
      return Promise.resolve({ affected: 1 });
    });

    const regenerated = await createService().regenerateDraft(
      7,
      current.id,
      {
        optimisticVersion: 1,
        instruction: '근거를 다시 골라 작성하세요.',
        selectedEvidenceIds: ['jira:100', 'jira:101'],
      },
      'correlation-id',
    );

    expect(aiClient.generate).toHaveBeenCalledWith(
      '근거를 다시 골라 작성하세요.',
      expect.arrayContaining([
        expect.objectContaining({ evidenceId: 'jira:101' }),
      ]),
    );
    expect(regenerated.evidence.map((item) => item.id)).toEqual([
      'jira:100',
      'jira:101',
    ]);
  });

  it('does not regenerate a stale draft or one at another version', async () => {
    const stale = createDraft({
      status: 'review_required',
      freshnessStatus: 'review_required',
    });
    repository.findOneBy.mockResolvedValue(stale);

    await expect(
      createService().regenerateDraft(
        7,
        stale.id,
        { optimisticVersion: 1, instruction: '다시 작성하세요.' },
        'correlation-id',
      ),
    ).rejects.toMatchObject({
      response: { code: 'SOURCE_REVIEW_REQUIRED' },
    });

    const current = createDraft({ optimisticVersion: 3 });
    repository.findOneBy.mockResolvedValue(current);

    await expect(
      createService().regenerateDraft(
        7,
        current.id,
        { optimisticVersion: 1, instruction: '다시 작성하세요.' },
        'correlation-id',
      ),
    ).rejects.toMatchObject({
      response: { code: 'DRAFT_VERSION_CONFLICT', currentVersion: 3 },
    });
    expect(aiClient.generate).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('marks a draft for review instead of regenerating on a moved issue', async () => {
    const current = createDraft();
    repository.findOneBy.mockImplementation(() => Promise.resolve(current));
    repository.update.mockImplementation((_where, values) => {
      Object.assign(current, values);
      return Promise.resolve({ affected: 1 });
    });
    jiraWorkItemService.collectIssueDraftContext.mockResolvedValue({
      accessStatus: 'accessible',
      profileId: current.profileId,
      sourceJiraId: current.sourceJiraId,
      sourceJiraKey: current.sourceJiraKey,
      sourceJiraVersion: '2026-08-05T00:00:00.000Z',
      evidence: [
        { evidence: current.evidence[0], content: 'newer transient evidence' },
      ],
    });

    await expect(
      createService().regenerateDraft(
        7,
        current.id,
        { optimisticVersion: 1, instruction: '다시 작성하세요.' },
        'correlation-id',
      ),
    ).rejects.toMatchObject({
      response: { code: 'SOURCE_REVIEW_REQUIRED', currentVersion: 2 },
    });
    expect(aiClient.generate).not.toHaveBeenCalled();
    // Refusing without recording the change would leave the stored draft
    // claiming to be current.
    expect(current.freshnessStatus).toBe('review_required');
    expect(current.status).toBe('review_required');
    // Clearing the signal stays refreshDraft's job.
    expect(current.sourceJiraVersion).toBe('2026-08-02T00:00:00.000Z');
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

  it('clears a webhook-only re-review state when every source is still current', async () => {
    const current = createDraft({
      status: 'review_required',
      freshnessStatus: 'review_required',
    });
    repository.findOneBy.mockResolvedValue(current);
    jiraWorkItemService.collectIssueDraftContext.mockResolvedValue({
      accessStatus: 'accessible',
      profileId: current.profileId,
      sourceJiraId: current.sourceJiraId,
      sourceJiraKey: current.sourceJiraKey,
      sourceJiraVersion: current.sourceJiraVersion,
      evidence: [
        {
          evidence: current.evidence[0],
          content: 're-read transient evidence',
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

    expect(refreshed.status).toBe('draft');
    expect(refreshed.freshnessStatus).toBe('current');
    expect(refreshed.blockers).toEqual([]);
    expect(refreshed.optimisticVersion).toBe(2);
  });

  it('marks a draft for re-review when selected Confluence metadata changes', async () => {
    const confluenceEvidence = {
      id: 'confluence:200',
      provider: 'confluence' as const,
      sourceId: '200',
      url: 'https://confluence.example.test/pages/viewpage.action?pageId=200',
      title: '배포 결정',
      version: '7',
      excerptLength: 88,
      accessStatus: 'accessible' as const,
      dlpStatus: 'not_evaluated' as const,
      aiStatus: 'included' as const,
    };
    const current = createDraft({
      evidence: [createDraft().evidence[0], confluenceEvidence],
    });
    repository.findOneBy.mockResolvedValue(current);
    jiraWorkItemService.collectIssueDraftContext.mockResolvedValue({
      accessStatus: 'accessible',
      profileId: current.profileId,
      sourceJiraId: current.sourceJiraId,
      sourceJiraKey: current.sourceJiraKey,
      sourceJiraVersion: current.sourceJiraVersion,
      evidence: [
        {
          evidence: current.evidence[0],
          content: 'Jira evidence stays transient.',
        },
      ],
    });
    confluenceWorkItemService.collectEvidenceMetadata.mockResolvedValue({
      accessStatus: 'accessible',
      profileId: current.profileId,
      evidence: [{ ...confluenceEvidence, version: '8' }],
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
    expect(
      confluenceWorkItemService.collectEvidenceMetadata,
    ).toHaveBeenCalledWith(7, ['confluence:200'], 'correlation-id');
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

  // R1 — `repository.update()` does not apply the soft delete filter, so a
  // missing `deletedAt: IsNull()` criterion would resurrect a deleted draft
  // without any type error to catch it.
  it('scopes an edit to live drafts so a deleted draft cannot be resurrected', async () => {
    const current = createDraft();
    repository.findOneBy.mockResolvedValue(current);
    repository.update.mockResolvedValue({ affected: 1 });
    aiClient.sanitize.mockResolvedValue([
      initialContent.title.text,
      initialContent.summary.text,
      initialContent.requirements[0].text,
      initialContent.risks[0].text,
      initialContent.nextSteps[0].text,
    ]);

    await createService().updateDraft(7, current.id, {
      optimisticVersion: 1,
      content: initialContent,
    });

    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({ deletedAt: IsNull() }),
      expect.anything(),
    );
  });

  it('scopes a refresh to live drafts so a deleted draft cannot be resurrected', async () => {
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
    repository.update.mockResolvedValue({ affected: 1 });

    await createService().refreshDraft(
      7,
      current.id,
      { optimisticVersion: 1 },
      'correlation-id',
    );

    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({ deletedAt: IsNull() }),
      expect.anything(),
    );
  });

  it('reports a deleted draft as not found when a stale tab saves', async () => {
    // A soft-deleted draft is invisible to every `find*` call, so the update
    // matches nothing and the follow-up lookup raises 404 rather than a
    // version conflict.
    repository.findOneBy.mockResolvedValueOnce(createDraft());
    repository.update.mockResolvedValue({ affected: 0 });
    repository.findOneBy.mockResolvedValueOnce(null);
    aiClient.sanitize.mockResolvedValue([
      initialContent.title.text,
      initialContent.summary.text,
      initialContent.requirements[0].text,
      initialContent.risks[0].text,
      initialContent.nextSteps[0].text,
    ]);

    await expect(
      createService().updateDraft(7, createDraft().id, {
        optimisticVersion: 1,
        content: initialContent,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports a deleted draft as not found when a stale tab refreshes', async () => {
    repository.findOneBy.mockResolvedValue(null);

    await expect(
      createService().refreshDraft(
        7,
        createDraft().id,
        { optimisticVersion: 1 },
        'correlation-id',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(jiraWorkItemService.collectIssueDraftContext).not.toHaveBeenCalled();
  });

  describe('listDrafts', () => {
    it('scopes the list to the caller and to live drafts', async () => {
      queryBuilder.getMany.mockResolvedValue([createDraft()]);

      await createService().listDrafts(7, {});

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'draft."createdByUserId" = :userId',
        { userId: 7 },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'draft."deletedAt" IS NULL',
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'draft."updatedAt"',
        'DESC',
      );
      expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
        'draft."id"',
        'DESC',
      );
    });

    // R5: the list must reproduce `present()`'s non-disclosure branch. Scan
    // the serialized response rather than named fields so a future field
    // cannot smuggle the title back in.
    it('omits the title and evidence count of an access-changed draft', async () => {
      queryBuilder.getMany.mockResolvedValue([
        createDraft({
          freshnessStatus: 'access_changed',
          status: 'review_required',
        }),
      ]);

      const list = await createService().listDrafts(7, {});

      expect(list.items[0].title).toBeNull();
      expect(list.items[0].evidenceCount).toBeNull();
      expect(list.items[0].blockers).toEqual([{ code: 'ACCESS_CHANGED' }]);
      expect(JSON.stringify(list)).not.toContain('배포 준비');
      expect(JSON.stringify(list)).not.toContain('jira:100');
    });

    it('exposes the title and evidence count of a readable draft', async () => {
      queryBuilder.getMany.mockResolvedValue([createDraft()]);

      const list = await createService().listDrafts(7, {});

      expect(list.items[0]).toMatchObject({
        sourceJiraKey: 'DEMO-1',
        title: '배포 준비',
        evidenceCount: 1,
        blockers: [],
      });
    });

    // R4: reading publication state must not fan out into per-draft recovery,
    // which can call Atlassian.
    it('reads stored publication rows once for the whole page', async () => {
      const first = createDraft();
      const second = createDraft({
        id: 'b1c1b8f0-0000-4000-8000-000000000002',
      });
      queryBuilder.getMany.mockResolvedValue([first, second]);
      publicationService.findLatestStoredSummaries.mockResolvedValue(
        new Map([
          [
            first.id,
            {
              draftId: first.id,
              id: 'pub-1',
              status: 'CONFLUENCE_PUBLISHED',
              externalWritePerformed: true,
            },
          ],
        ]),
      );

      const list = await createService().listDrafts(7, {});

      expect(
        publicationService.findLatestStoredSummaries,
      ).toHaveBeenCalledTimes(1);
      expect(publicationService.findLatestStoredSummaries).toHaveBeenCalledWith(
        [first.id, second.id],
      );
      expect(list.items[0].publication).toEqual({
        id: 'pub-1',
        status: 'CONFLUENCE_PUBLISHED',
        externalWritePerformed: true,
      });
      expect(list.items[1].publication).toBeNull();
    });

    it('returns a cursor only while more drafts remain', async () => {
      const drafts = Array.from({ length: 3 }, (_unused, index) =>
        createDraft({
          id: `b1c1b8f0-0000-4000-8000-00000000000${index}`,
          updatedAt: new Date(`2026-08-0${index + 1}T00:00:00.000Z`),
        }),
      );
      queryBuilder.getMany.mockResolvedValue(drafts);

      const page = await createService().listDrafts(7, { limit: 2 });

      expect(queryBuilder.take).toHaveBeenCalledWith(3);
      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).not.toBeNull();

      queryBuilder.getMany.mockResolvedValue(drafts.slice(0, 2));
      const lastPage = await createService().listDrafts(7, { limit: 2 });
      expect(lastPage.nextCursor).toBeNull();
    });

    // R12: the cursor carries an id tiebreaker so drafts sharing an updatedAt
    // are neither repeated nor skipped.
    it('pages with a row-value keyset that includes the id tiebreaker', async () => {
      const draft = createDraft({
        updatedAt: new Date('2026-08-02T00:00:00.000Z'),
      });
      queryBuilder.getMany.mockResolvedValue([
        draft,
        createDraft({ id: 'b1c1b8f0-0000-4000-8000-000000000009' }),
      ]);
      const first = await createService().listDrafts(7, { limit: 1 });
      expect(first.nextCursor).not.toBeNull();
      queryBuilder.getMany.mockResolvedValue([]);

      await createService().listDrafts(7, {
        limit: 1,
        cursor: first.nextCursor ?? undefined,
      });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '(draft."updatedAt", draft."id") < (:cursorUpdatedAt, :cursorId)',
        {
          cursorUpdatedAt: draft.updatedAt,
          cursorId: draft.id,
        },
      );
    });

    it('rejects a cursor that does not decode to a timestamp and id', async () => {
      await expect(
        createService().listDrafts(7, {
          cursor: Buffer.from('not-a-cursor', 'utf8').toString('base64url'),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(queryBuilder.getMany).not.toHaveBeenCalled();
    });

    it('rejects a decodable cursor whose id is not a UUID before querying Postgres', async () => {
      await expect(
        createService().listDrafts(7, {
          cursor: Buffer.from(
            '2026-08-02T00:00:00.000Z|not-a-uuid',
            'utf8',
          ).toString('base64url'),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(queryBuilder.getMany).not.toHaveBeenCalled();
    });

    it('filters by status only when one is requested', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await createService().listDrafts(7, { status: 'review_required' });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'draft."status" = :status',
        { status: 'review_required' },
      );
    });
  });

  describe('deleteDraft', () => {
    it('soft-deletes, purges evidence fragments and records a content-free audit event', async () => {
      const draft = createDraft();
      repository.findOneBy.mockResolvedValue(draft);
      repository.update.mockResolvedValue({ affected: 1 });

      await createService().deleteDraft(7, draft.id, 'correlation-id');

      const [criteria, values] = repository.update.mock.calls[0];
      expect(criteria).toEqual(
        expect.objectContaining({
          id: draft.id,
          createdByUserId: 7,
          deletedAt: IsNull(),
        }),
      );
      expect(values.deletedAt).toBeInstanceOf(Date);
      expect(fragments.purgeDraft).toHaveBeenCalledWith(
        draft.id,
        transactionManager,
      );
      expect(audit.record).toHaveBeenCalledWith({
        actorUserId: 7,
        action: 'BRIEF_DRAFT_DELETED',
        profileId: draft.profileId,
        targetId: `draft:${draft.id}:issue:${draft.sourceJiraKey}`,
        correlationId: 'correlation-id',
        resultCode: 'SOFT_DELETED',
      });
      expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
        '배포 준비',
      );
    });

    it('reports another user’s draft as not found without touching publications', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        createService().deleteDraft(8, createDraft().id, 'correlation-id'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(publicationService.assessDraftDeletion).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('refuses to delete while a publication is running', async () => {
      repository.findOneBy.mockResolvedValue(createDraft());
      publicationService.assessDraftDeletion.mockResolvedValue({
        publishing: true,
        externalWritePerformed: false,
      });

      await expect(
        createService().deleteDraft(7, createDraft().id, 'correlation-id'),
      ).rejects.toMatchObject({
        response: { code: 'PUBLICATION_IN_PROGRESS' },
      });
      expect(repository.update).not.toHaveBeenCalled();
      expect(fragments.purgeDraft).not.toHaveBeenCalled();
    });

    // R6: deleting would free the issue for a new draft whose publication
    // would duplicate the Confluence page that already exists.
    it('refuses to delete a draft that already wrote to Confluence', async () => {
      repository.findOneBy.mockResolvedValue(createDraft());
      publicationService.assessDraftDeletion.mockResolvedValue({
        publishing: false,
        externalWritePerformed: true,
      });

      await expect(
        createService().deleteDraft(7, createDraft().id, 'correlation-id'),
      ).rejects.toMatchObject({
        response: { code: 'DRAFT_HAS_PUBLICATION' },
      });
      expect(repository.update).not.toHaveBeenCalled();
      expect(fragments.purgeDraft).not.toHaveBeenCalled();
    });

    it('does not purge fragments when the row was deleted concurrently', async () => {
      repository.findOneBy.mockResolvedValue(createDraft());
      repository.update.mockResolvedValue({ affected: 0 });

      await expect(
        createService().deleteDraft(7, createDraft().id, 'correlation-id'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(fragments.purgeDraft).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  it('tells the user a draft may belong to someone else instead of a bare conflict', async () => {
    const existing = createDraft();
    jiraWorkItemService.collectIssueDraftContext.mockResolvedValue({
      accessStatus: 'accessible',
      profileId: existing.profileId,
      sourceJiraId: existing.sourceJiraId,
      sourceJiraKey: existing.sourceJiraKey,
      sourceJiraVersion: existing.sourceJiraVersion,
      evidence: [{ evidence: existing.evidence[0], content: 'transient' }],
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
    ).rejects.toMatchObject({
      response: {
        code: 'DRAFT_ALREADY_EXISTS',
        message: expect.stringMatching(/another user/),
      },
    });
  });
});
