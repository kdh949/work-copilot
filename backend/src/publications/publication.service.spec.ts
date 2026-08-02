import { ConflictException } from '@nestjs/common';
import type { IntegrationProfile } from '../integrations/profiles/entities/integration-profile.entity';
import type { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';
import { MockPublicationWriteGateway } from './mock-publication-write.gateway';
import { PublicationService } from './publication.service';
import type { BriefPublication } from './entities/brief-publication.entity';
import type { PublicationStep } from './entities/publication-step.entity';

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
  } as unknown as IntegrationProfile;
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
  const gateway = new MockPublicationWriteGateway();
  const service = new PublicationService(
    draftsRepository as never,
    profilesRepository as never,
    publicationsRepository as never,
    stepsRepository as never,
    readinessService as never,
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
    profilesRepository,
  };
}

describe('PublicationService', () => {
  it('publishes every configured mock step once and reuses the same idempotency key', async () => {
    const harness = createHarness();
    const confluence = jest.spyOn(harness.gateway, 'upsertConfluenceBrief');
    const remoteLink = jest.spyOn(harness.gateway, 'upsertJiraRemoteLink');
    const comment = jest.spyOn(harness.gateway, 'createJiraSummaryComment');
    const childTask = jest.spyOn(harness.gateway, 'createJiraChildTask');

    const first = await harness.service.publish(
      7,
      DRAFT_ID,
      { draftVersion: 3, approved: true, idempotencyKey: 'retry-safe-key' },
      'corr-1',
    );
    const second = await harness.service.publish(
      7,
      DRAFT_ID,
      { draftVersion: 3, approved: true, idempotencyKey: 'retry-safe-key' },
      'corr-2',
    );

    expect(first.status).toBe('PUBLISHED');
    expect(first.executionMode).toBe('mock');
    expect(first.externalWritePerformed).toBe(false);
    expect(second).toEqual(first);
    expect(harness.publications).toHaveLength(1);
    expect(confluence).toHaveBeenCalledTimes(1);
    expect(remoteLink).toHaveBeenCalledTimes(1);
    expect(comment).toHaveBeenCalledTimes(1);
    expect(childTask).toHaveBeenCalledTimes(1);
    expect(confluence).toHaveBeenCalledWith(
      expect.objectContaining({ parentPageId: '98765' }),
    );
    expect(
      JSON.stringify({
        publications: harness.publications,
        steps: harness.steps,
      }),
    ).not.toContain('마스킹된 배포 브리프');

    const newKey = await harness.service.publish(
      7,
      DRAFT_ID,
      { draftVersion: 3, approved: true, idempotencyKey: 'accidental-new-key' },
      'corr-3',
    );
    expect(newKey.id).toBe(first.id);
    expect(harness.publications).toHaveLength(1);
    expect(confluence).toHaveBeenCalledTimes(1);
  });

  it('records a Confluence version conflict as a recoverable review state', async () => {
    const harness = createHarness();
    harness.gateway.failNext(
      'confluence_page',
      'CONFLUENCE_VERSION_CONFLICT',
      false,
    );
    const remoteLink = jest.spyOn(harness.gateway, 'upsertJiraRemoteLink');

    const conflicted = await harness.service.publish(
      7,
      DRAFT_ID,
      { draftVersion: 3, approved: true, idempotencyKey: 'conflict-key' },
      'corr-1',
    );

    expect(conflicted.status).toBe('NEEDS_REVIEW');
    expect(conflicted.requiresReview).toBe(true);
    expect(conflicted.canRetry).toBe(true);
    expect(conflicted.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'confluence_page',
          status: 'NEEDS_REVIEW',
          errorCode: 'CONFLUENCE_VERSION_CONFLICT',
        }),
      ]),
    );
    expect(remoteLink).not.toHaveBeenCalled();

    const recovered = await harness.service.retry(
      7,
      DRAFT_ID,
      conflicted.id,
      { draftVersion: 3, approved: true },
      'corr-2',
    );

    expect(recovered.status).toBe('PUBLISHED');
    expect(
      recovered.steps.find((step) => step.key === 'confluence_page')?.attempts,
    ).toBe(2);
    expect(remoteLink).toHaveBeenCalledTimes(1);
  });

  it('recovers a partial comment failure without repeating successful provider objects', async () => {
    const harness = createHarness();
    harness.gateway.failNext(
      'jira_summary_comment',
      'JIRA_SUMMARY_COMMENT_FAILED',
    );
    const confluence = jest.spyOn(harness.gateway, 'upsertConfluenceBrief');
    const remoteLink = jest.spyOn(harness.gateway, 'upsertJiraRemoteLink');
    const comment = jest.spyOn(harness.gateway, 'createJiraSummaryComment');
    const childTask = jest.spyOn(harness.gateway, 'createJiraChildTask');

    const partial = await harness.service.publish(
      7,
      DRAFT_ID,
      { draftVersion: 3, approved: true, idempotencyKey: 'comment-key' },
      'corr-1',
    );

    expect(partial.status).toBe('PARTIALLY_PUBLISHED');
    expect(
      partial.steps.find((step) => step.key === 'jira_summary_comment'),
    ).toMatchObject({ status: 'FAILED', retryable: true });
    expect(childTask).not.toHaveBeenCalled();

    const recovered = await harness.service.retry(
      7,
      DRAFT_ID,
      partial.id,
      { draftVersion: 3, approved: true },
      'corr-2',
    );

    expect(recovered.status).toBe('PUBLISHED');
    expect(confluence).toHaveBeenCalledTimes(1);
    expect(remoteLink).toHaveBeenCalledTimes(1);
    expect(comment).toHaveBeenCalledTimes(2);
    expect(childTask).toHaveBeenCalledTimes(1);
  });

  it('retries only a failed selected child task while retaining sibling task progress', async () => {
    const harness = createHarness([FIRST_TASK_ID, SECOND_TASK_ID]);
    harness.gateway.failNext(
      `jira_child_task:${FIRST_TASK_ID}`,
      'JIRA_CHILD_TASK_FAILED',
    );
    const childTask = jest.spyOn(harness.gateway, 'createJiraChildTask');

    const partial = await harness.service.publish(
      7,
      DRAFT_ID,
      { draftVersion: 3, approved: true, idempotencyKey: 'child-key' },
      'corr-1',
    );

    expect(partial.status).toBe('PARTIALLY_PUBLISHED');
    expect(childTask).toHaveBeenCalledTimes(2);
    expect(
      partial.steps.find((step) => step.key.endsWith(FIRST_TASK_ID)),
    ).toMatchObject({ status: 'FAILED' });
    expect(
      partial.steps.find((step) => step.key.endsWith(SECOND_TASK_ID)),
    ).toMatchObject({ status: 'SUCCEEDED' });

    const recovered = await harness.service.retry(
      7,
      DRAFT_ID,
      partial.id,
      { draftVersion: 3, approved: true },
      'corr-2',
    );

    expect(recovered.status).toBe('PUBLISHED');
    expect(childTask).toHaveBeenCalledTimes(3);
  });

  it('recreates missing pending step records before resuming a recoverable publication', async () => {
    const harness = createHarness();
    harness.publications.push({
      id: 'publication-recovery',
      draftId: DRAFT_ID,
      operationId: '33333333-3333-4333-8333-333333333333',
      idempotencyKeyHash: 'safe-hash',
      draftVersion: 3,
      status: 'PENDING',
      confluenceContentId: null,
      jiraRemoteLinkId: null,
      approvedByUserId: 7,
      approvedAt: new Date(),
      executionMode: 'mock',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const recovered = await harness.service.retry(
      7,
      DRAFT_ID,
      'publication-recovery',
      { draftVersion: 3, approved: true },
      'corr-recovery',
    );

    expect(recovered.status).toBe('PUBLISHED');
    expect(recovered.steps).toHaveLength(4);
    expect(recovered.steps.every((step) => step.status === 'SUCCEEDED')).toBe(
      true,
    );
  });

  it('does not start the saga when approval, version, readiness, or parent configuration is invalid', async () => {
    const harness = createHarness();
    const confluence = jest.spyOn(harness.gateway, 'upsertConfluenceBrief');

    await expect(
      harness.service.publish(
        7,
        DRAFT_ID,
        { draftVersion: 3, approved: false, idempotencyKey: 'approval-key' },
        'corr-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      harness.service.publish(
        7,
        DRAFT_ID,
        { draftVersion: 2, approved: true, idempotencyKey: 'version-key' },
        'corr-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    harness.readinessService.assertDraftPublishAllowed.mockRejectedValueOnce(
      new ConflictException({ code: 'DRAFT_NOT_READY_FOR_PUBLISH' }),
    );
    await expect(
      harness.service.publish(
        7,
        DRAFT_ID,
        { draftVersion: 3, approved: true, idempotencyKey: 'readiness-key' },
        'corr-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    harness.profile.briefParentPageId = null;
    await expect(
      harness.service.publish(
        7,
        DRAFT_ID,
        { draftVersion: 3, approved: true, idempotencyKey: 'parent-key' },
        'corr-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(confluence).not.toHaveBeenCalled();
    expect(harness.publications).toHaveLength(0);
  });
});
