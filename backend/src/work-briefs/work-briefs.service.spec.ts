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
    aiClient.generate.mockResolvedValue({
      title: '배포 준비',
      summary: '테스트를 진행합니다.',
      keyPoints: ['회귀 테스트를 실행합니다.'],
      risks: ['일정 지연'],
      nextSteps: ['승인 요청'],
      evidenceIds: ['jira:100', 'confluence:200'],
    });

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
    expect(confluenceWorkItemService.collectEvidenceMetadata).toHaveBeenCalledWith(
      7,
      ['confluence:200'],
      'correlation-id',
    );
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
