import { ConflictException } from '@nestjs/common';
import type { IntegrationProfile } from '../integrations/profiles/entities/integration-profile.entity';
import type { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';
import type { BriefPublication } from './entities/brief-publication.entity';
import type { PublicationStep } from './entities/publication-step.entity';
import { MockPublicationWriteGateway } from './mock-publication-write.gateway';
import type {
  ConfluencePublicationPreview,
  JiraPublicationPreview,
} from './publication-preview.service';
import { PublicationService } from './publication.service';

const PROFILE_ID = 'bc4ed2ab-812a-4162-a7a7-e0ea1bd4b48e';
const DRAFT_ID = '0e9a46da-cce1-4f35-a0ee-2488f8596391';
const FIRST_TASK_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_TASK_ID = '22222222-2222-4222-8222-222222222222';

function createDraft(
  selectedTaskIds: string[] = [FIRST_TASK_ID],
): WorkBriefDraft {
  return {
    id: DRAFT_ID,
    profileId: PROFILE_ID,
    createdByUserId: 7,
    sourceJiraId: '100',
    sourceJiraKey: 'DEMO-1',
    sourceJiraVersion: '2026-08-02T00:00:00.000Z',
    maskedBrief: {
      title: { text: '마스킹된 배포 브리프', evidenceIds: ['jira:100'] },
      summary: { text: '마스킹된 요약 댓글', evidenceIds: ['jira:100'] },
      requirements: [{ text: '배포 요구사항', evidenceIds: ['jira:100'] }],
      acceptanceCriteria: [{ text: '검증 결과', evidenceIds: ['jira:100'] }],
      risks: [],
      nextSteps: [],
      childTasks: [FIRST_TASK_ID, SECOND_TASK_ID].map(
        (clientTaskId, index) => ({
          clientTaskId,
          text: `하위 작업 ${index + 1}`,
          summary: `하위 작업 요약 ${index + 1}`,
          evidenceIds: ['jira:100'],
          selected: selectedTaskIds.includes(clientTaskId),
        }),
      ),
    },
    evidence: [
      {
        id: 'jira:100',
        provider: 'jira',
        sourceId: '100',
        url: 'https://jira.example.test/browse/DEMO-1',
        title: '배포 근거',
        version: '2026-08-02T00:00:00.000Z',
        excerptLength: 80,
        accessStatus: 'accessible',
        dlpStatus: 'not_evaluated',
        aiStatus: 'included',
      },
    ],
    status: 'draft',
    freshnessStatus: 'current',
    optimisticVersion: 3,
    policyVersion: 1,
    createdAt: new Date('2026-08-02T00:00:00.000Z'),
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
  };
}

function createProfile(): IntegrationProfile {
  return {
    id: PROFILE_ID,
    isActive: true,
    briefParentPageId: '98765',
    policy: {
      childTaskTemplate: {
        issueTypeId: '10001',
        fields: { customfield_10100: 'configured' },
      },
    },
  } as IntegrationProfile;
}

function matches(
  candidate: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(
    ([key, value]) => candidate[key] === value,
  );
}

function createHarness(selectedTaskIds: string[] = [FIRST_TASK_ID]) {
  const draft = createDraft(selectedTaskIds);
  const profile = createProfile();
  const publications: BriefPublication[] = [];
  const steps: PublicationStep[] = [];
  let publicationCounter = 0;
  let stepCounter = 0;

  const draftsRepository = {
    findOneBy: jest.fn(() => Promise.resolve(draft)),
  };
  const profilesRepository = {
    findOneBy: jest.fn(() => Promise.resolve(profile)),
  };
  const publicationsRepository = {
    create: jest.fn((values: Partial<BriefPublication>) => ({
      id: `publication-${++publicationCounter}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...values,
    })),
    save: jest.fn((publication: BriefPublication) => {
      const existing = publications.find((item) => item.id === publication.id);
      if (existing) {
        Object.assign(existing, publication);
      } else {
        publications.push(publication);
      }
      return Promise.resolve(publication);
    }),
    findOneBy: jest.fn((where: Record<string, unknown>) =>
      Promise.resolve(
        publications.find((item) => matches(item as never, where)) ?? null,
      ),
    ),
    find: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        publications.filter((item) => matches(item as never, where)),
      ),
    ),
  };
  const stepsRepository = {
    create: jest.fn((values: Partial<PublicationStep>) => ({
      id: `step-${++stepCounter}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...values,
    })),
    save: jest.fn((value: PublicationStep | PublicationStep[]) => {
      const values = Array.isArray(value) ? value : [value];
      for (const step of values) {
        const existing = steps.find((item) => item.id === step.id);
        if (existing) {
          Object.assign(existing, step);
        } else {
          steps.push(step);
        }
      }
      return Promise.resolve(value);
    }),
    find: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(steps.filter((item) => matches(item as never, where))),
    ),
  };
  const readinessService = {
    assertDraftPublishAllowed: jest.fn().mockResolvedValue(undefined),
  };
  const confluencePreview: ConfluencePublicationPreview = {
    phase: 'confluence',
    draftVersion: 3,
    previewHash: 'confluence-preview-hash',
    spaceKey: 'DEMO',
    parentPage: {
      id: '98765',
      title: '배포 브리프',
      url: 'https://confluence.example.test/pages/viewpage.action?pageId=98765',
      version: '4',
    },
    pageTitle: '[DEMO-1] 마스킹된 배포 브리프',
    bodyPreview: '<p>미리보기</p>',
    contentHash: 'content-hash',
    evidence: [
      {
        id: 'jira:100',
        provider: 'jira',
        title: '배포 근거',
        url: 'https://jira.example.test/browse/DEMO-1',
        version: '2026-08-02T00:00:00.000Z',
      },
    ],
  };
  const previewService = {
    confluence: jest.fn(() => Promise.resolve(confluencePreview)),
    jira: jest.fn(
      (_draft: WorkBriefDraft, publication: BriefPublication) =>
        ({
          phase: 'jira',
          draftVersion: 3,
          previewHash: `jira-preview-${publication.confluenceContentId}`,
          confluencePage: {
            id: publication.confluenceContentId,
            url: publication.confluencePageUrl,
            title: '[DEMO-1] 마스킹된 배포 브리프',
          },
          remoteLink: {
            globalId: `work-copilot:publication:${publication.operationId}`,
            url: publication.confluencePageUrl,
            title: '[DEMO-1] 마스킹된 배포 브리프',
          },
          summaryComment: {
            summary: '마스킹된 요약 댓글',
            url: publication.confluencePageUrl,
          },
        }) as JiraPublicationPreview,
    ),
    childTasks: jest.fn(
      (currentDraft: WorkBriefDraft, publication: BriefPublication) => ({
        phase: 'child_tasks',
        draftVersion: 3,
        previewHash: `child-preview-${publication.confluenceContentId}`,
        childTasks: currentDraft.maskedBrief.childTasks
          .filter((task) => task.selected)
          .map((task) => ({
            clientTaskId: task.clientTaskId,
            summary: task.summary,
          })),
      }),
    ),
  };
  const gateway = new MockPublicationWriteGateway();
  const service = new PublicationService(
    draftsRepository as never,
    profilesRepository as never,
    publicationsRepository as never,
    stepsRepository as never,
    readinessService as never,
    previewService as never,
    gateway,
  );

  return {
    service,
    gateway,
    draft,
    profile,
    publications,
    steps,
    readinessService,
    previewService,
  };
}

async function publishConfluence(
  harness: ReturnType<typeof createHarness>,
  key = 'confluence-key',
) {
  const preview = await harness.service.previewConfluence(7, DRAFT_ID, 'corr');
  return harness.service.publish(
    7,
    DRAFT_ID,
    {
      draftVersion: 3,
      approved: true,
      previewHash: preview.previewHash,
      idempotencyKey: key,
    },
    'corr',
  );
}

async function publishJira(
  harness: ReturnType<typeof createHarness>,
  publicationId: string,
  key = 'jira-key',
) {
  const preview = await harness.service.previewJira(7, DRAFT_ID, publicationId);
  return harness.service.publishJira(
    7,
    DRAFT_ID,
    publicationId,
    {
      draftVersion: 3,
      approved: true,
      previewHash: preview.previewHash,
      idempotencyKey: key,
    },
    'corr',
  );
}

async function publishChildTasks(
  harness: ReturnType<typeof createHarness>,
  publicationId: string,
  key = 'child-tasks-key',
) {
  const preview = await harness.service.previewChildTasks(
    7,
    DRAFT_ID,
    publicationId,
    'corr',
  );
  return harness.service.publishChildTasks(
    7,
    DRAFT_ID,
    publicationId,
    {
      draftVersion: 3,
      approved: true,
      previewHash: preview.previewHash,
      idempotencyKey: key,
    },
    'corr',
  );
}

describe('PublicationService', () => {
  it('creates only the Confluence page after the first approved preview', async () => {
    const harness = createHarness();
    const confluence = jest.spyOn(harness.gateway, 'upsertConfluenceBrief');
    const remoteLink = jest.spyOn(harness.gateway, 'upsertJiraRemoteLink');
    const comment = jest.spyOn(harness.gateway, 'createJiraSummaryComment');
    const childTask = jest.spyOn(harness.gateway, 'createJiraChildTask');

    const first = await publishConfluence(harness, 'confluence-key');
    const second = await publishConfluence(harness, 'confluence-key');

    expect(first.status).toBe('CONFLUENCE_PUBLISHED');
    expect(first.executionMode).toBe('mock');
    expect(first.externalWritePerformed).toBe(false);
    expect(first.confluencePage?.id).toContain('mock-confluence:');
    expect(first.confluencePage?.version).toBe('1');
    expect(second).toEqual(first);
    expect(harness.publications).toHaveLength(1);
    expect(confluence).toHaveBeenCalledTimes(1);
    expect(remoteLink).not.toHaveBeenCalled();
    expect(comment).not.toHaveBeenCalled();
    expect(childTask).not.toHaveBeenCalled();
    expect(confluence).toHaveBeenCalledWith(
      expect.objectContaining({ parentPageId: '98765' }),
    );
    expect(
      JSON.stringify({
        publications: harness.publications,
        steps: harness.steps,
      }),
    ).not.toContain('마스킹된 배포 브리프');
  });

  it('skips an already completed Confluence retry without replacing page metadata', async () => {
    const harness = createHarness();
    const confluence = jest.spyOn(harness.gateway, 'upsertConfluenceBrief');
    const published = await publishConfluence(harness, 'confluence-key');
    const retryPreview = await harness.service.previewConfluence(
      7,
      DRAFT_ID,
      'corr',
    );

    const retried = await harness.service.retry(
      7,
      DRAFT_ID,
      published.id,
      {
        phase: 'confluence',
        draftVersion: 3,
        approved: true,
        previewHash: retryPreview.previewHash,
        idempotencyKey: 'confluence-key',
      },
      'corr',
    );

    expect(retried.status).toBe('CONFLUENCE_PUBLISHED');
    expect(retried.confluencePage).toEqual(published.confluencePage);
    expect(confluence).toHaveBeenCalledTimes(1);
  });

  it('runs Jira link and comment only after a separately approved Jira preview', async () => {
    const harness = createHarness();
    const remoteLink = jest.spyOn(harness.gateway, 'upsertJiraRemoteLink');
    const comment = jest.spyOn(harness.gateway, 'createJiraSummaryComment');
    const childTask = jest.spyOn(harness.gateway, 'createJiraChildTask');

    const confluence = await publishConfluence(harness);
    const jira = await publishJira(harness, confluence.id);

    expect(jira.status).toBe('JIRA_PUBLISHED');
    expect(remoteLink).toHaveBeenCalledTimes(1);
    expect(comment).toHaveBeenCalledTimes(1);
    expect(childTask).not.toHaveBeenCalled();
    expect(jira.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'confluence_page',
          phase: 'confluence',
          status: 'SUCCEEDED',
        }),
        expect.objectContaining({
          key: 'jira_remote_link',
          phase: 'jira',
          status: 'SUCCEEDED',
        }),
        expect.objectContaining({
          key: 'jira_summary_comment',
          phase: 'jira',
          status: 'SUCCEEDED',
        }),
      ]),
    );
  });

  it('retries only the failed Jira comment and retains the existing remote link', async () => {
    const harness = createHarness();
    harness.gateway.failNext(
      'jira_summary_comment',
      'JIRA_SUMMARY_COMMENT_FAILED',
    );
    const remoteLink = jest.spyOn(harness.gateway, 'upsertJiraRemoteLink');
    const comment = jest.spyOn(harness.gateway, 'createJiraSummaryComment');

    const confluence = await publishConfluence(harness);
    const partial = await publishJira(harness, confluence.id, 'jira-key');
    expect(partial.status).toBe('PARTIALLY_PUBLISHED');
    expect(
      partial.steps.find((step) => step.key === 'jira_summary_comment'),
    ).toMatchObject({ status: 'FAILED', retryable: true });

    const retryPreview = await harness.service.previewJira(
      7,
      DRAFT_ID,
      partial.id,
    );
    const recovered = await harness.service.retry(
      7,
      DRAFT_ID,
      partial.id,
      {
        phase: 'jira',
        draftVersion: 3,
        approved: true,
        previewHash: retryPreview.previewHash,
        idempotencyKey: 'jira-key',
      },
      'corr',
    );

    expect(recovered.status).toBe('JIRA_PUBLISHED');
    expect(remoteLink).toHaveBeenCalledTimes(1);
    expect(comment).toHaveBeenCalledTimes(2);
  });

  it('creates selected child tasks last and reconciles an individual failed task', async () => {
    const harness = createHarness([FIRST_TASK_ID, SECOND_TASK_ID]);
    harness.gateway.failNext(
      `jira_child_task:${FIRST_TASK_ID}`,
      'JIRA_CHILD_TASK_FAILED',
    );
    const childTask = jest.spyOn(harness.gateway, 'createJiraChildTask');

    const confluence = await publishConfluence(harness);
    const jira = await publishJira(harness, confluence.id);
    const partial = await publishChildTasks(
      harness,
      jira.id,
      'child-tasks-key',
    );

    expect(partial.status).toBe('PARTIALLY_PUBLISHED');
    expect(childTask).toHaveBeenCalledTimes(2);
    expect(
      partial.steps.find((step) => step.key.endsWith(FIRST_TASK_ID)),
    ).toMatchObject({ status: 'FAILED' });
    expect(
      partial.steps.find((step) => step.key.endsWith(SECOND_TASK_ID)),
    ).toMatchObject({ status: 'SUCCEEDED' });
    expect(
      harness.steps.find((step) => step.stepKey.endsWith(FIRST_TASK_ID))
        ?.idempotencyKeyHash,
    ).toMatch(/^[a-f0-9]{64}$/);

    const retryPreview = await harness.service.previewChildTasks(
      7,
      DRAFT_ID,
      partial.id,
      'corr',
    );
    const recovered = await harness.service.retry(
      7,
      DRAFT_ID,
      partial.id,
      {
        phase: 'child_tasks',
        draftVersion: 3,
        approved: true,
        previewHash: retryPreview.previewHash,
        idempotencyKey: 'child-tasks-key',
      },
      'corr',
    );

    expect(recovered.status).toBe('PUBLISHED');
    expect(childTask).toHaveBeenCalledTimes(3);
  });

  it('requires a fresh approved preview and the original phase idempotency key', async () => {
    const harness = createHarness();
    const preview = await harness.service.previewConfluence(
      7,
      DRAFT_ID,
      'corr',
    );

    await expect(
      harness.service.publish(
        7,
        DRAFT_ID,
        {
          draftVersion: 3,
          approved: true,
          previewHash: 'stale-preview',
          idempotencyKey: 'confluence-key',
        },
        'corr',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const confluence = await harness.service.publish(
      7,
      DRAFT_ID,
      {
        draftVersion: 3,
        approved: true,
        previewHash: preview.previewHash,
        idempotencyKey: 'confluence-key',
      },
      'corr',
    );
    const jiraPreview = await harness.service.previewJira(
      7,
      DRAFT_ID,
      confluence.id,
    );
    const jira = await harness.service.publishJira(
      7,
      DRAFT_ID,
      confluence.id,
      {
        draftVersion: 3,
        approved: true,
        previewHash: jiraPreview.previewHash,
        idempotencyKey: 'jira-key',
      },
      'corr',
    );
    const childPreview = await harness.service.previewChildTasks(
      7,
      DRAFT_ID,
      jira.id,
      'corr',
    );

    await expect(
      harness.service.publishChildTasks(
        7,
        DRAFT_ID,
        jira.id,
        {
          draftVersion: 3,
          approved: true,
          previewHash: childPreview.previewHash,
          idempotencyKey: 'different-child-tasks-key',
        },
        'corr',
      ),
    ).resolves.toMatchObject({ status: 'PUBLISHED' });

    await expect(
      harness.service.publishChildTasks(
        7,
        DRAFT_ID,
        jira.id,
        {
          draftVersion: 3,
          approved: true,
          previewHash: childPreview.previewHash,
          idempotencyKey: 'other-child-tasks-key',
        },
        'corr',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not start Confluence publication when approval, version, readiness, or parent configuration is invalid', async () => {
    const harness = createHarness();
    const confluence = jest.spyOn(harness.gateway, 'upsertConfluenceBrief');
    const preview = await harness.service.previewConfluence(
      7,
      DRAFT_ID,
      'corr',
    );

    await expect(
      harness.service.publish(
        7,
        DRAFT_ID,
        {
          draftVersion: 3,
          approved: false,
          previewHash: preview.previewHash,
          idempotencyKey: 'approval-key',
        },
        'corr',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      harness.service.publish(
        7,
        DRAFT_ID,
        {
          draftVersion: 2,
          approved: true,
          previewHash: preview.previewHash,
          idempotencyKey: 'version-key',
        },
        'corr',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    harness.readinessService.assertDraftPublishAllowed.mockRejectedValueOnce(
      new ConflictException({ code: 'DRAFT_NOT_READY_FOR_PUBLISH' }),
    );
    await expect(
      harness.service.publish(
        7,
        DRAFT_ID,
        {
          draftVersion: 3,
          approved: true,
          previewHash: preview.previewHash,
          idempotencyKey: 'readiness-key',
        },
        'corr',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    harness.profile.briefParentPageId = null;
    await expect(
      harness.service.publish(
        7,
        DRAFT_ID,
        {
          draftVersion: 3,
          approved: true,
          previewHash: preview.previewHash,
          idempotencyKey: 'parent-key',
        },
        'corr',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(confluence).not.toHaveBeenCalled();
    expect(harness.publications).toHaveLength(0);
  });
});
