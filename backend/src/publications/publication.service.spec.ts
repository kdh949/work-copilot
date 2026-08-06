import { ConflictException, NotFoundException } from '@nestjs/common';
import type { IntegrationProfile } from '../integrations/profiles/entities/integration-profile.entity';
import { BriefCitationValidatorService } from '../work-briefs/brief-citation-validator.service';
import { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';
import { WorkBriefsService } from '../work-briefs/work-briefs.service';
import { BriefPublication } from './entities/brief-publication.entity';
import { PublicationStep } from './entities/publication-step.entity';
import { MockPublicationWriteGateway } from './mock-publication-write.gateway';
import type { PublicationWriteResult } from './publication-write-gateway';
import type {
  ConfluencePublicationPreview,
  JiraPublicationPreview,
} from './publication-preview.service';
import { PUBLICATION_STEP_HEARTBEAT_INTERVAL_MS } from './publication-step-claimer.service';
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
    deletedAt: null,
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
  let publicationSaveFailure:
    ((publication: BriefPublication) => boolean) | null = null;
  let failStepInsert = false;

  const draftsRepository = {
    findOneBy: jest.fn(() => Promise.resolve(draft.deletedAt ? null : draft)),
    update: jest.fn(
      (_criteria: unknown, values: Partial<WorkBriefDraft>) => {
        Object.assign(draft, values);
        return Promise.resolve({ affected: 1 });
      },
    ),
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
      if (publicationSaveFailure?.(publication)) {
        publicationSaveFailure = null;
        return Promise.reject(new Error('publication aggregate save failed'));
      }
      const existing = publications.find((item) => item.id === publication.id);
      const persisted = { ...publication };
      if (existing) {
        Object.assign(existing, persisted);
      } else {
        publications.push(persisted);
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
    // Stands in for the one joined publication/step query used by the draft
    // list. It deliberately includes every publication for the draft because
    // an older durable external result must not be hidden by a newer row.
    query: jest.fn((_sql: string, [draftIds]: [string[]]) =>
      Promise.resolve(
        draftIds.flatMap((draftId) =>
          publications
            .filter((item) => item.draftId === draftId)
            .sort(
              (left, right) =>
                right.createdAt.getTime() - left.createdAt.getTime(),
            )
            .flatMap((publication) => {
              const publicationSteps = steps.filter(
                (step) => step.publicationId === publication.id,
              );
              const row = {
                id: publication.id,
                draftId: publication.draftId,
                status: publication.status,
                executionMode: publication.executionMode,
                confluenceContentId: publication.confluenceContentId,
              };
              return publicationSteps.length > 0
                ? publicationSteps.map((step) => ({
                    ...row,
                    stepPublicationId: step.publicationId,
                    stepStatus: step.status,
                    stepProviderObjectId: step.providerObjectId,
                    stepErrorCode: step.errorCode,
                  }))
                : [
                    {
                      ...row,
                      stepPublicationId: null,
                      stepStatus: null,
                      stepProviderObjectId: null,
                      stepErrorCode: null,
                    },
                  ];
            }),
        ),
      ),
    ),
    createQueryBuilder: jest.fn(() => {
      let assignments: Record<string, unknown> = {};
      let parameters: Record<string, unknown> = {};
      const builder: Record<string, jest.Mock> = {
        update: jest.fn(() => builder),
        set: jest.fn((values: Record<string, unknown>) => {
          assignments = values;
          return builder;
        }),
        where: jest.fn((_clause: string, values: Record<string, unknown>) => {
          parameters = values;
          return builder;
        }),
        returning: jest.fn(() => builder),
        execute: jest.fn(() => {
          const publication = publications.find(
            (item) => item.id === parameters.id,
          );
          if (!publication) {
            return Promise.resolve({ affected: 0, raw: [] });
          }
          const record = publication as unknown as Record<string, unknown>;
          for (const [key, value] of Object.entries(assignments)) {
            if (typeof value !== 'function') {
              record[key] = value;
              continue;
            }
            const expression = (value as () => string)();
            const increment = /^"(\w+)" \+ 1$/.exec(expression);
            if (increment) {
              record[increment[1]] = Number(record[increment[1]] ?? 0) + 1;
            }
          }
          return Promise.resolve({
            affected: 1,
            raw: [{ approvalRevision: publication.approvalRevision }],
          });
        }),
      };
      return builder;
    }),
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
    upsert: jest.fn((values: PublicationStep[]) => {
      for (const step of values) {
        const existing = steps.find(
          (item) =>
            item.publicationId === step.publicationId &&
            item.stepKey === step.stepKey,
        );
        if (existing) {
          Object.assign(existing, step);
        } else {
          steps.push(step);
        }
      }
      return Promise.resolve();
    }),
    update: jest.fn(
      (where: Record<string, unknown>, values: Partial<PublicationStep>) => {
        for (const step of steps) {
          if (matches(step as never, where)) {
            Object.assign(step, values);
          }
        }
        return Promise.resolve();
      },
    ),
    insert: jest.fn((value: PublicationStep) => {
      if (failStepInsert) {
        return Promise.reject(new Error('step insert failed'));
      }
      const existing = steps.find((item) => item.id === value.id);
      if (!existing) {
        steps.push(value);
      }
      return Promise.resolve();
    }),
    createQueryBuilder: jest.fn(() => {
      let values: PublicationStep[] = [];
      const builder: Record<string, jest.Mock> = {
        insert: jest.fn(() => builder),
        into: jest.fn(() => builder),
        values: jest.fn((nextValues: PublicationStep[]) => {
          values = nextValues;
          return builder;
        }),
        orIgnore: jest.fn(() => builder),
        execute: jest.fn(() => {
          for (const step of values) {
            const existing = steps.find(
              (candidate) =>
                candidate.publicationId === step.publicationId &&
                candidate.stepKey === step.stepKey,
            );
            if (!existing) {
              steps.push(step);
            }
          }
          return Promise.resolve();
        }),
      };
      return builder;
    }),
    find: jest.fn(
      ({
        where,
      }: {
        where: Record<string, unknown> | Array<Record<string, unknown>>;
      }) =>
        Promise.resolve(
          steps.filter((item) =>
            (Array.isArray(where) ? where : [where]).some((criteria) =>
              matches(item as never, criteria),
            ),
          ),
        ),
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
      (
        currentDraft: WorkBriefDraft,
        publication: BriefPublication,
        currentProfile: IntegrationProfile,
      ) => ({
        phase: 'child_tasks',
        draftVersion: 3,
        previewHash: `child-preview-${publication.confluenceContentId}-${JSON.stringify(currentProfile.policy.childTaskTemplate)}`,
        configurationFingerprint: JSON.stringify(
          currentProfile.policy.childTaskTemplate,
        ),
        childTasks: currentDraft.maskedBrief.childTasks
          .filter((task) => task.selected)
          .map((task) => ({
            clientTaskId: task.clientTaskId,
            summary: task.summary,
            payload: {},
          })),
      }),
    ),
  };
  const gateway = new MockPublicationWriteGateway();
  const stepClaimer = {
    claim: jest.fn().mockResolvedValue({
      claimed: true,
      executionToken: 'execution-token-test',
      leaseExpiresAt: new Date(Date.now() + 30_000),
    }),
    heartbeat: jest.fn().mockResolvedValue(true),
    reopenForReview: jest.fn((stepId: string, revision: number) => {
      const step = steps.find((candidate) => candidate.id === stepId);
      if (
        !step ||
        step.status !== 'NEEDS_REVIEW' ||
        step.reviewRevision !== revision ||
        (step.approvedRevision !== null &&
          step.approvedRevision >= step.reviewRevision)
      ) {
        return Promise.resolve(false);
      }
      step.status = 'PENDING';
      step.errorCode = null;
      step.approvedRevision = revision;
      step.executionToken = null;
      step.executionLeaseExpiresAt = null;
      return Promise.resolve(true);
    }),
    markSucceeded: jest.fn(
      (stepId: string, _token: string, result: PublicationWriteResult) => {
        const step = steps.find((candidate) => candidate.id === stepId);
        if (!step) return Promise.resolve(false);
        Object.assign(step, {
          status: 'SUCCEEDED',
          providerObjectId: result.providerObjectId,
          providerObjectVersion: result.providerObjectVersion ?? null,
          providerUrl: result.providerUrl ?? null,
          contentHash: result.contentHash ?? null,
          errorCode: null,
          executionToken: null,
          executionLeaseExpiresAt: null,
        });
        return Promise.resolve(true);
      },
    ),
    markFailed: jest.fn(
      (stepId: string, _token: string, status: PublicationStep['status'], errorCode: PublicationStep['errorCode']) => {
        const step = steps.find((candidate) => candidate.id === stepId);
        if (!step) return Promise.resolve(false);
        Object.assign(step, {
          status,
          errorCode,
          executionToken: null,
          executionLeaseExpiresAt: null,
        });
        return Promise.resolve(true);
      },
    ),
  };
  const dataSource = {
    transaction: async (
      callback: (manager: {
        query: jest.Mock;
        getRepository: (
          entity: unknown,
        ) =>
          | typeof draftsRepository
          | typeof publicationsRepository
          | typeof stepsRepository;
      }) => unknown,
    ) => {
      const publicationSnapshot = [...publications];
      const stepSnapshot = [...steps];
      try {
        return await callback({
          query: jest.fn().mockResolvedValue([]),
          getRepository: jest.fn((entity: unknown) => {
            if (entity === WorkBriefDraft) return draftsRepository;
            if (entity === BriefPublication) return publicationsRepository;
            return stepsRepository;
          }),
        });
      } catch (error) {
        publications.splice(0, publications.length, ...publicationSnapshot);
        steps.splice(0, steps.length, ...stepSnapshot);
        throw error;
      }
    },
  };
  const service = new PublicationService(
    draftsRepository as never,
    profilesRepository as never,
    publicationsRepository as never,
    stepsRepository as never,
    readinessService as never,
    previewService as never,
    gateway,
    stepClaimer as never,
    dataSource as never,
    undefined,
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
    stepClaimer,
    publicationsRepository,
    stepsRepository,
    dataSource,
    draftsRepository,
    failStepInsert: () => {
      failStepInsert = true;
    },
    failPublicationSaveWhen: (
      predicate: (publication: BriefPublication) => boolean,
    ) => {
      publicationSaveFailure = predicate;
    },
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
  it('lets a delete win the first-publication race without calling the write gateway', async () => {
    const harness = createHarness();
    const preview = await harness.service.previewConfluence(7, DRAFT_ID, 'corr');
    const lockQuery = jest.fn().mockResolvedValue([]);
    let transactionTail = Promise.resolve();
    const lockingDataSource = {
      transaction: async (
        callback: (manager: {
          query: typeof lockQuery;
          getRepository: (entity: unknown) => unknown;
        }) => Promise<unknown>,
      ) => {
        const previous = transactionTail;
        let releaseTransaction: () => void = () => undefined;
        transactionTail = new Promise<void>((resolve) => {
          releaseTransaction = resolve;
        });
        await previous;
        try {
          return await callback({
            query: lockQuery,
            getRepository: (entity: unknown) => {
              if (entity === WorkBriefDraft) return harness.draftsRepository;
              if (entity === BriefPublication) {
                return harness.publicationsRepository;
              }
              return harness.stepsRepository;
            },
          });
        } finally {
          releaseTransaction();
        }
      },
    };
    harness.dataSource.transaction = lockingDataSource.transaction as never;

    let releasePreflight: (value: typeof preview) => void = () => undefined;
    const preflightReached = new Promise<void>((resolve) => {
      harness.previewService.confluence.mockImplementationOnce(
        () =>
          new Promise<typeof preview>((resolvePreview) => {
            releasePreflight = resolvePreview;
            resolve();
          }),
      );
    });
    let releaseFragmentPurge: () => void = () => undefined;
    let markFragmentPurgeStarted: () => void = () => undefined;
    const fragmentPurgeStarted = new Promise<void>((resolve) => {
      markFragmentPurgeStarted = resolve;
    });
    const fragments = {
      purgeDraft: jest.fn(
        () =>
          new Promise<void>((resolvePurge) => {
            releaseFragmentPurge = resolvePurge;
            markFragmentPurgeStarted();
          }),
      ),
    };
    const workBriefs = new WorkBriefsService(
      harness.draftsRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new BriefCitationValidatorService(),
      harness.service,
      fragments as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      lockingDataSource as never,
    );
    const writeGateway = jest.spyOn(harness.gateway, 'upsertConfluenceBrief');

    const publishPromise = harness.service.publish(
      7,
      DRAFT_ID,
      {
        draftVersion: 3,
        approved: true,
        previewHash: preview.previewHash,
        idempotencyKey: 'delete-race-key',
      },
      'corr',
    );
    await preflightReached;

    const deletePromise = workBriefs.deleteDraft(7, DRAFT_ID, 'corr');

    // Start the delete while publish still has only preflight data in memory.
    // It soft-deletes inside its transaction, then deliberately waits before
    // commit so the publish reservation has to wait for the same lock.
    await fragmentPurgeStarted;
    releasePreflight(preview);
    releaseFragmentPurge();

    await expect(deletePromise).resolves.toBeUndefined();
    await expect(publishPromise).rejects.toBeInstanceOf(NotFoundException);
    expect(writeGateway).not.toHaveBeenCalled();
    expect(lockQuery).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`work-brief-draft:${DRAFT_ID}`],
    );
  });

  it('rolls back the publication when the initial Confluence step insert fails', async () => {
    const harness = createHarness([FIRST_TASK_ID]);
    harness.failStepInsert();
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
          previewHash: preview.previewHash,
          approvalRevision: preview.approvalRevision,
          idempotencyKey: 'transaction-rollback-key',
        },
        'corr',
      ),
    ).rejects.toThrow('step insert failed');

    expect(harness.publications).toHaveLength(0);
    expect(harness.steps).toHaveLength(0);
  });

  it('repairs a pending publication with no steps before calling Confluence', async () => {
    const harness = createHarness();
    harness.publications.push(
      harness.publicationsRepository.create({
        draftId: DRAFT_ID,
        operationId: 'seed-operation',
        idempotencyKeyHash: 'seed-key',
        draftVersion: 3,
        status: 'PENDING',
        approvalRevision: 1,
        confluenceContentId: null,
        jiraRemoteLinkId: null,
        jiraSummaryCommentId: null,
        confluencePageVersion: null,
        confluencePageUrl: null,
        confluenceContentHash: null,
        requestedByUserId: 7,
        requestedAt: new Date(),
        approvedByUserId: 7,
        approvedAt: new Date(),
        jiraIdempotencyKeyHash: null,
        childTasksIdempotencyKeyHash: null,
        confluencePreviewHash: null,
        jiraPreviewHash: null,
        childTasksPreviewHash: null,
        jiraApprovedByUserId: null,
        jiraApprovedAt: null,
        childTasksApprovedByUserId: null,
        childTasksApprovedAt: null,
        executionMode: 'mock',
        reviewRequiredAt: null,
      }),
    );
    const preview = await harness.service.previewConfluence(
      7,
      DRAFT_ID,
      'corr',
    );
    const confluence = jest.spyOn(harness.gateway, 'upsertConfluenceBrief');

    const recovered = await harness.service.publish(
      7,
      DRAFT_ID,
      {
        draftVersion: 3,
        approved: true,
        previewHash: preview.previewHash,
        approvalRevision: preview.approvalRevision,
        idempotencyKey: 'repair-empty-step-key',
      },
      'corr',
    );

    expect(recovered.status).toBe('CONFLUENCE_PUBLISHED');
    expect(harness.steps).toHaveLength(1);
    expect(confluence).toHaveBeenCalledTimes(1);
  });

  it('never treats an empty current phase as completed', () => {
    const harness = createHarness();
    const service = harness.service as unknown as {
      statusFor: (
        steps: readonly PublicationStep[],
        phase: 'confluence' | 'jira' | 'child_tasks',
        draft: WorkBriefDraft,
      ) => string;
    };

    expect(service.statusFor([], 'confluence', harness.draft)).toBe('PENDING');
  });

  it('does not auto-complete a publication whose Jira steps lack Confluence', async () => {
    const harness = createHarness();
    const publication = harness.publicationsRepository.create({
      draftId: DRAFT_ID,
      operationId: 'invalid-order-operation',
      idempotencyKeyHash: 'invalid-order-key',
      draftVersion: 3,
      status: 'PENDING',
      approvalRevision: 1,
      confluenceContentId: null,
      jiraRemoteLinkId: null,
      jiraSummaryCommentId: null,
      confluencePageVersion: null,
      confluencePageUrl: null,
      confluenceContentHash: null,
      requestedByUserId: 7,
      requestedAt: new Date(),
      approvedByUserId: 7,
      approvedAt: new Date(),
      jiraIdempotencyKeyHash: null,
      childTasksIdempotencyKeyHash: null,
      confluencePreviewHash: null,
      jiraPreviewHash: null,
      childTasksPreviewHash: null,
      jiraApprovedByUserId: null,
      jiraApprovedAt: null,
      childTasksApprovedByUserId: null,
      childTasksApprovedAt: null,
      executionMode: 'mock',
      reviewRequiredAt: null,
    });
    harness.publications.push(publication);
    harness.steps.push(
      harness.stepsRepository.create({
        publicationId: publication.id,
        stepKey: 'jira_remote_link',
        phase: 'jira',
        status: 'SUCCEEDED',
        attempts: 1,
        errorCode: null,
        providerObjectId: 'jira-link-1',
        providerObjectVersion: null,
        providerUrl: null,
        contentHash: null,
        idempotencyKeyHash: null,
        executionToken: null,
        executionLeaseExpiresAt: null,
        reviewRevision: 1,
        approvedRevision: 1,
      }),
    );

    const recovered = await harness.service.findLatest(7, DRAFT_ID);

    expect(recovered.status).toBe('NEEDS_REVIEW');
    expect(recovered.requiresReview).toBe(true);
  });

  it('creates each missing phase step once when ensureSteps calls race', async () => {
    const harness = createHarness();
    const publication = { id: 'ensure-publication', approvalRevision: 1 } as BriefPublication;
    const service = harness.service as unknown as {
      ensureSteps: (
        publication: BriefPublication,
        phase: 'jira',
        loadedSteps?: PublicationStep[],
      ) => Promise<PublicationStep[]>;
    };

    const [first, second] = await Promise.all([
      service.ensureSteps(publication, 'jira', []),
      service.ensureSteps(publication, 'jira', []),
    ]);

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(harness.steps).toHaveLength(2);
    expect(harness.steps.map((step) => step.stepKey).sort()).toEqual([
      'jira_remote_link',
      'jira_summary_comment',
    ]);
  });

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

  it('starts a new draft version with a fresh approval revision', async () => {
    const harness = createHarness();
    await publishConfluence(harness, 'old-draft-version-key');
    harness.draft.optimisticVersion = 4;

    const preview = await harness.service.previewConfluence(
      7,
      DRAFT_ID,
      'corr',
    );

    expect(preview.approvalRevision).toBe(1);
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
        idempotencyKey: 'new-browser-confluence-retry-key',
      },
      'corr',
    );

    expect(retried.status).toBe('CONFLUENCE_PUBLISHED');
    expect(retried.confluencePage).toEqual(published.confluencePage);
    expect(retried.requiresReview).toBe(false);
    expect(confluence).toHaveBeenCalledTimes(1);
  });

  it('does not reuse the old approval after a non-retryable provider failure', async () => {
    const harness = createHarness();
    harness.gateway.failNext(
      'confluence_page',
      'CONFLUENCE_WRITE_FAILED',
      false,
    );
    const confluence = jest.spyOn(harness.gateway, 'upsertConfluenceBrief');
    const firstPreview = await harness.service.previewConfluence(
      7,
      DRAFT_ID,
      'corr',
    );
    const first = await harness.service.publish(
      7,
      DRAFT_ID,
      {
        draftVersion: 3,
        approved: true,
        previewHash: firstPreview.previewHash,
        approvalRevision: firstPreview.approvalRevision,
        idempotencyKey: 'needs-review-key',
      },
      'corr',
    );

    expect(first.status).toBe('NEEDS_REVIEW');
    const oldApproval = await harness.service.retry(
      7,
      DRAFT_ID,
      first.id,
      {
        phase: 'confluence',
        draftVersion: 3,
        approved: true,
        previewHash: firstPreview.previewHash,
        approvalRevision: firstPreview.approvalRevision,
        idempotencyKey: 'old-review-key',
      },
      'corr',
    );

    expect(oldApproval.status).toBe('NEEDS_REVIEW');
    expect(confluence).toHaveBeenCalledTimes(1);

    const freshPreview = await harness.service.previewConfluence(
      7,
      DRAFT_ID,
      'corr',
    );
    const retried = await harness.service.retry(
      7,
      DRAFT_ID,
      first.id,
      {
        phase: 'confluence',
        draftVersion: 3,
        approved: true,
        previewHash: freshPreview.previewHash,
        approvalRevision: freshPreview.approvalRevision,
        idempotencyKey: 'fresh-review-key',
      },
      'corr',
    );

    expect(retried.status).toBe('CONFLUENCE_PUBLISHED');
    expect(confluence).toHaveBeenCalledTimes(2);
  });

  it('requires a new approval revision even when the regenerated preview hash is unchanged', async () => {
    const harness = createHarness();
    harness.gateway.failNext(
      'confluence_page',
      'CONFLUENCE_WRITE_FAILED',
      false,
    );
    const firstPreview = await harness.service.previewConfluence(
      7,
      DRAFT_ID,
      'corr',
    );
    const first = await harness.service.publish(
      7,
      DRAFT_ID,
      {
        draftVersion: 3,
        approved: true,
        previewHash: firstPreview.previewHash,
        approvalRevision: 1,
        idempotencyKey: 'same-hash-needs-review',
      },
      'corr',
    );
    const freshPreview = await harness.service.previewConfluence(
      7,
      DRAFT_ID,
      'corr',
    );

    await expect(
      harness.service.retry(
        7,
        DRAFT_ID,
        first.id,
        {
          phase: 'confluence',
          draftVersion: 3,
          approved: true,
          previewHash: freshPreview.previewHash,
          approvalRevision: 1,
          idempotencyKey: 'same-hash-old-revision',
        },
        'corr',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      harness.steps.find((step) => step.stepKey === 'confluence_page')?.status,
    ).toBe('NEEDS_REVIEW');
  });

  it('requires another preview after a second non-retryable review failure', async () => {
    const harness = createHarness();
    harness.gateway.failNext(
      'confluence_page',
      'CONFLUENCE_WRITE_FAILED',
      false,
    );
    const firstPreview = await harness.service.previewConfluence(
      7,
      DRAFT_ID,
      'corr',
    );
    const first = await harness.service.publish(
      7,
      DRAFT_ID,
      {
        draftVersion: 3,
        approved: true,
        previewHash: firstPreview.previewHash,
        approvalRevision: firstPreview.approvalRevision,
        idempotencyKey: 'review-failure-one',
      },
      'corr',
    );
    harness.gateway.failNext(
      'confluence_page',
      'CONFLUENCE_WRITE_FAILED',
      false,
    );
    const freshPreview = await harness.service.previewConfluence(
      7,
      DRAFT_ID,
      'corr',
    );
    const second = await harness.service.retry(
      7,
      DRAFT_ID,
      first.id,
      {
        phase: 'confluence',
        draftVersion: 3,
        approved: true,
        previewHash: freshPreview.previewHash,
        approvalRevision: freshPreview.approvalRevision,
        idempotencyKey: 'review-failure-two',
      },
      'corr',
    );
    const confluence = jest.spyOn(harness.gateway, 'upsertConfluenceBrief');

    const third = await harness.service.retry(
      7,
      DRAFT_ID,
      second.id,
      {
        phase: 'confluence',
        draftVersion: 3,
        approved: true,
        previewHash: freshPreview.previewHash,
        approvalRevision: freshPreview.approvalRevision,
        idempotencyKey: 'review-failure-reused-approval',
      },
      'corr',
    );

    expect(second.status).toBe('NEEDS_REVIEW');
    expect(third.status).toBe('NEEDS_REVIEW');
    expect(confluence).not.toHaveBeenCalled();
  });

  it('lets only one concurrent fresh approval reopen and execute a needs-review step', async () => {
    const harness = createHarness();
    harness.gateway.failNext(
      'confluence_page',
      'CONFLUENCE_WRITE_FAILED',
      false,
    );
    const firstPreview = await harness.service.previewConfluence(
      7,
      DRAFT_ID,
      'corr',
    );
    const failed = await harness.service.publish(
      7,
      DRAFT_ID,
      {
        draftVersion: 3,
        approved: true,
        previewHash: firstPreview.previewHash,
        approvalRevision: firstPreview.approvalRevision,
        idempotencyKey: 'concurrent-review-seed',
      },
      'corr',
    );
    const freshPreview = await harness.service.previewConfluence(
      7,
      DRAFT_ID,
      'corr',
    );
    let resolveProvider: ((result: PublicationWriteResult) => void) | undefined;
    const provider = new Promise<PublicationWriteResult>((resolve) => {
      resolveProvider = resolve;
    });
    const confluence = jest
      .spyOn(harness.gateway, 'upsertConfluenceBrief')
      .mockImplementation(() => provider);
    harness.stepClaimer.claim
      .mockResolvedValueOnce({
        claimed: true,
        executionToken: 'fresh-token',
        leaseExpiresAt: new Date(Date.now() + 30_000),
      })
      .mockResolvedValueOnce({ claimed: false });

    const first = harness.service.retry(
      7,
      DRAFT_ID,
      failed.id,
      {
        phase: 'confluence',
        draftVersion: 3,
        approved: true,
        previewHash: freshPreview.previewHash,
        approvalRevision: freshPreview.approvalRevision,
        idempotencyKey: 'concurrent-review-first',
      },
      'corr',
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const second = await harness.service.retry(
      7,
      DRAFT_ID,
      failed.id,
      {
        phase: 'confluence',
        draftVersion: 3,
        approved: true,
        previewHash: freshPreview.previewHash,
        approvalRevision: freshPreview.approvalRevision,
        idempotencyKey: 'concurrent-review-second',
      },
      'corr',
    );

    resolveProvider?.({ providerObjectId: 'reconciled-page' });
    const firstResult = await first;

    expect(second.status).toBe('PUBLISHING');
    expect(firstResult.status).toBe('CONFLUENCE_PUBLISHED');
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
        idempotencyKey: 'new-browser-jira-retry-key',
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
    const childTaskReconciliation = jest.spyOn(
      harness.gateway,
      'reconcileJiraChildTasks',
    );

    const confluence = await publishConfluence(harness);
    const jira = await publishJira(harness, confluence.id);
    const partial = await publishChildTasks(
      harness,
      jira.id,
      'child-tasks-key',
    );

    expect(partial.status).toBe('PARTIALLY_PUBLISHED');
    expect(childTask).toHaveBeenCalledTimes(2);
    expect(childTaskReconciliation).toHaveBeenCalledTimes(1);
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
        idempotencyKey: 'new-browser-child-tasks-retry-key',
      },
      'corr',
    );

    expect(recovered.status).toBe('PUBLISHED');
    expect(childTask).toHaveBeenCalledTimes(3);
  });

  it('requires a fresh approved preview and accepts a new phase command key', async () => {
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
    ).resolves.toMatchObject({ status: 'PUBLISHED' });
  });

  it('returns an already completed command before mutable readiness checks', async () => {
    const harness = createHarness();
    const confluence = jest.spyOn(harness.gateway, 'upsertConfluenceBrief');

    const first = await publishConfluence(harness, 'lost-response-key');
    harness.readinessService.assertDraftPublishAllowed.mockRejectedValueOnce(
      new ConflictException({ code: 'DRAFT_NOT_READY_FOR_PUBLISH' }),
    );

    const replayed = await harness.service.publish(
      7,
      DRAFT_ID,
      {
        draftVersion: 3,
        approved: true,
        previewHash: 'not-recomputed-on-replay',
        idempotencyKey: 'lost-response-key',
      },
      'corr',
    );

    expect(replayed).toEqual(first);
    expect(confluence).toHaveBeenCalledTimes(1);
    expect(
      harness.readinessService.assertDraftPublishAllowed,
    ).toHaveBeenCalledTimes(1);
  });

  it('recovers Confluence aggregate metadata from a succeeded durable step', async () => {
    const harness = createHarness();
    harness.failPublicationSaveWhen(
      (publication) => publication.confluenceContentId !== null,
    );
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
          previewHash: preview.previewHash,
          idempotencyKey: 'confluence-key',
        },
        'corr',
      ),
    ).rejects.toThrow('publication aggregate save failed');
    const persisted = harness.publications[0];
    expect(persisted.confluenceContentId).toBeNull();
    expect(harness.steps[0]).toMatchObject({
      status: 'SUCCEEDED',
      providerObjectId: expect.any(String),
      providerUrl: expect.any(String),
    });
    const retryPreview = await harness.service.previewConfluence(
      7,
      DRAFT_ID,
      'corr',
    );

    const recovered = await harness.service.retry(
      7,
      DRAFT_ID,
      persisted.id,
      {
        phase: 'confluence',
        draftVersion: 3,
        approved: true,
        previewHash: retryPreview.previewHash,
        idempotencyKey: 'new-browser-recovery-key',
      },
      'corr',
    );

    expect(recovered.status).toBe('CONFLUENCE_PUBLISHED');
    expect(recovered.confluencePage).toMatchObject({
      id: harness.steps[0].providerObjectId,
      url: harness.steps[0].providerUrl,
    });
    await expect(
      harness.service.previewJira(7, DRAFT_ID, persisted.id),
    ).resolves.toMatchObject({ phase: 'jira' });
  });

  it('lets only one concurrent retry call the provider for a step', async () => {
    const harness = createHarness();
    const confluence = await publishConfluence(harness);
    const preview = await harness.service.previewJira(
      7,
      DRAFT_ID,
      confluence.id,
    );
    harness.stepClaimer.claim.mockClear();
    harness.stepClaimer.claim
      .mockResolvedValueOnce({
        claimed: true,
        executionToken: 'execution-token-first',
        leaseExpiresAt: new Date(Date.now() + 30_000),
      })
      .mockResolvedValueOnce({ claimed: false })
      .mockResolvedValue({
        claimed: true,
        executionToken: 'execution-token-next',
        leaseExpiresAt: new Date(Date.now() + 30_000),
      });

    let resolveLink: (result: PublicationWriteResult) => void;
    const pendingLink = new Promise<PublicationWriteResult>((resolve) => {
      resolveLink = resolve;
    });
    const remoteLink = jest
      .spyOn(harness.gateway, 'upsertJiraRemoteLink')
      .mockImplementationOnce(() => pendingLink);

    const first = harness.service.publishJira(
      7,
      DRAFT_ID,
      confluence.id,
      {
        draftVersion: 3,
        approved: true,
        previewHash: preview.previewHash,
        idempotencyKey: 'concurrent-first-key',
      },
      'corr',
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    const second = await harness.service.publishJira(
      7,
      DRAFT_ID,
      confluence.id,
      {
        draftVersion: 3,
        approved: true,
        previewHash: preview.previewHash,
        idempotencyKey: 'concurrent-second-key',
      },
      'corr',
    );
    resolveLink!({ providerObjectId: 'remote-link-1' });
    const firstResult = await first;

    expect(second.status).toBe('PUBLISHING');
    expect(firstResult.status).toBe('JIRA_PUBLISHED');
    expect(remoteLink).toHaveBeenCalledTimes(1);
  });

  it('heartbeats a long-running provider operation and clears the timer', async () => {
    jest.useFakeTimers();
    try {
      const harness = createHarness();
      const preview = await harness.service.previewConfluence(
        7,
        DRAFT_ID,
        'corr',
      );
      let resolveProvider: ((result: PublicationWriteResult) => void) | undefined;
      const provider = new Promise<PublicationWriteResult>((resolve) => {
        resolveProvider = resolve;
      });
      jest
        .spyOn(harness.gateway, 'upsertConfluenceBrief')
        .mockImplementation(() => provider);

      const resultPromise = harness.service.publish(
        7,
        DRAFT_ID,
        {
          draftVersion: 3,
          approved: true,
          previewHash: preview.previewHash,
          approvalRevision: preview.approvalRevision,
          idempotencyKey: 'heartbeat-key',
        },
        'corr',
      );
      await Promise.resolve();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(
        PUBLICATION_STEP_HEARTBEAT_INTERVAL_MS,
      );

      expect(harness.stepClaimer.heartbeat).toHaveBeenCalledWith(
        expect.any(String),
        'execution-token-test',
      );
      resolveProvider?.({ providerObjectId: 'heartbeat-page' });
      await expect(resultPromise).resolves.toMatchObject({
        status: 'CONFLUENCE_PUBLISHED',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not let a stale worker overwrite a newer fenced result', async () => {
    const harness = createHarness();
    const preview = await harness.service.previewConfluence(
      7,
      DRAFT_ID,
      'corr',
    );
    let resolveProvider: ((result: PublicationWriteResult) => void) | undefined;
    const provider = new Promise<PublicationWriteResult>((resolve) => {
      resolveProvider = resolve;
    });
    jest
      .spyOn(harness.gateway, 'upsertConfluenceBrief')
      .mockImplementation(() => provider);
    const resultPromise = harness.service.publish(
      7,
      DRAFT_ID,
      {
        draftVersion: 3,
        approved: true,
        previewHash: preview.previewHash,
        approvalRevision: preview.approvalRevision,
        idempotencyKey: 'stale-worker-key',
      },
      'corr',
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const step = harness.steps[0];
    Object.assign(step, {
      status: 'SUCCEEDED',
      providerObjectId: 'new-worker-page',
      providerObjectVersion: null,
      providerUrl: 'https://mock.example.invalid/confluence/new-worker-page',
      contentHash: null,
    });
    harness.stepClaimer.markSucceeded.mockResolvedValueOnce(false);
    resolveProvider?.({ providerObjectId: 'stale-worker-page' });

    const result = await resultPromise;

    expect(result.status).toBe('CONFLUENCE_PUBLISHED');
    expect(result.confluencePage?.id).toBe('new-worker-page');
    expect(result.confluencePage?.id).not.toBe('stale-worker-page');
  });

  it('rejects a child-task approval when its template changes after preview', async () => {
    const harness = createHarness();
    const childTask = jest.spyOn(harness.gateway, 'createJiraChildTask');
    const confluence = await publishConfluence(harness);
    const jira = await publishJira(harness, confluence.id);
    const preview = await harness.service.previewChildTasks(
      7,
      DRAFT_ID,
      jira.id,
      'corr',
    );
    harness.profile.policy.childTaskTemplate = {
      issueTypeId: '10001',
      fields: { customfield_10100: 'changed-after-preview' },
    };

    await expect(
      harness.service.publishChildTasks(
        7,
        DRAFT_ID,
        jira.id,
        {
          draftVersion: 3,
          approved: true,
          previewHash: preview.previewHash,
          idempotencyKey: 'stale-child-task-preview-key',
        },
        'corr',
      ),
    ).rejects.toMatchObject({
      response: { code: 'PUBLICATION_PREVIEW_STALE' },
    });
    expect(childTask).not.toHaveBeenCalled();
  });

  it('parks an interrupted child-task execution instead of re-issuing the create', async () => {
    const harness = createHarness();
    const confluence = await publishConfluence(harness);
    const jira = await publishJira(harness, confluence.id);
    const childTask = jest.spyOn(harness.gateway, 'createJiraChildTask');
    // The worker that owned this step was killed while the Jira create may
    // already have been dispatched; a later caller takes over its lapsed lease.
    harness.stepClaimer.claim.mockResolvedValueOnce({
      claimed: true,
      executionToken: 'reclaimed-token',
      leaseExpiresAt: new Date(Date.now() + 30_000),
      reclaimedInterrupted: true,
    });

    const result = await publishChildTasks(harness, jira.id);

    expect(childTask).not.toHaveBeenCalled();
    expect(result.requiresReview).toBe(true);
    expect(
      harness.steps.find((step) => step.phase === 'child_tasks'),
    ).toMatchObject({
      status: 'NEEDS_REVIEW',
      errorCode: 'PUBLICATION_RECONCILIATION_INDETERMINATE',
    });
  });

  it('creates the child task only once the parked execution is re-approved', async () => {
    const harness = createHarness();
    const confluence = await publishConfluence(harness);
    const jira = await publishJira(harness, confluence.id);
    const childTask = jest.spyOn(harness.gateway, 'createJiraChildTask');
    harness.stepClaimer.claim.mockResolvedValueOnce({
      claimed: true,
      executionToken: 'reclaimed-token',
      leaseExpiresAt: new Date(Date.now() + 30_000),
      reclaimedInterrupted: true,
    });
    const parked = await publishChildTasks(harness, jira.id, 'parked-key');
    expect(parked.requiresReview).toBe(true);

    // A plain retry carrying the same approval must not reach the provider.
    await expect(
      harness.service.retry(
        7,
        DRAFT_ID,
        jira.id,
        {
          phase: 'child_tasks',
          draftVersion: 3,
          approved: true,
          previewHash: `child-preview-${confluence.confluencePage?.id}-${JSON.stringify(harness.profile.policy.childTaskTemplate)}`,
          idempotencyKey: 'parked-retry-key',
        },
        'corr',
      ),
    ).rejects.toMatchObject({
      response: { code: 'PUBLICATION_REVIEW_APPROVAL_REQUIRED' },
    });
    expect(childTask).not.toHaveBeenCalled();

    const freshPreview = await harness.service.previewChildTasks(
      7,
      DRAFT_ID,
      jira.id,
      'corr',
    );
    const reapproved = await harness.service.publishChildTasks(
      7,
      DRAFT_ID,
      jira.id,
      {
        draftVersion: 3,
        approved: true,
        previewHash: freshPreview.previewHash,
        approvalRevision: freshPreview.approvalRevision,
        idempotencyKey: 'reapproved-key',
      },
      'corr',
    );

    expect(reapproved.status).toBe('PUBLISHED');
    expect(childTask).toHaveBeenCalledTimes(1);
  });

  it('parks an interrupted Confluence execution without a second page write', async () => {
    const harness = createHarness();
    const confluence = jest.spyOn(harness.gateway, 'upsertConfluenceBrief');
    harness.stepClaimer.claim.mockResolvedValueOnce({
      claimed: true,
      executionToken: 'reclaimed-token',
      leaseExpiresAt: new Date(Date.now() + 30_000),
      reclaimedInterrupted: true,
    });

    const result = await publishConfluence(harness, 'interrupted-key');

    expect(confluence).not.toHaveBeenCalled();
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.confluencePage).toBeNull();
    expect(
      harness.steps.find((step) => step.stepKey === 'confluence_page'),
    ).toMatchObject({
      status: 'NEEDS_REVIEW',
      errorCode: 'PUBLICATION_RECONCILIATION_INDETERMINATE',
    });
  });

  it('does not auto-retry a step whose provider write outcome is unknown', async () => {
    const harness = createHarness();
    harness.gateway.failNext(
      'confluence_page',
      'PUBLICATION_RECONCILIATION_INDETERMINATE',
      false,
    );
    const confluence = jest.spyOn(harness.gateway, 'upsertConfluenceBrief');
    const preview = await harness.service.previewConfluence(
      7,
      DRAFT_ID,
      'corr',
    );
    const first = await harness.service.publish(
      7,
      DRAFT_ID,
      {
        draftVersion: 3,
        approved: true,
        previewHash: preview.previewHash,
        approvalRevision: preview.approvalRevision,
        idempotencyKey: 'ambiguous-write-key',
      },
      'corr',
    );

    expect(first.status).toBe('NEEDS_REVIEW');
    expect(
      harness.steps.find((step) => step.stepKey === 'confluence_page'),
    ).toMatchObject({ status: 'NEEDS_REVIEW' });

    await expect(
      harness.service.retry(
        7,
        DRAFT_ID,
        first.id,
        {
          phase: 'confluence',
          draftVersion: 3,
          approved: true,
          previewHash: preview.previewHash,
          idempotencyKey: 'ambiguous-retry-key',
        },
        'corr',
      ),
    ).rejects.toMatchObject({
      response: { code: 'PUBLICATION_REVIEW_APPROVAL_REQUIRED' },
    });
    expect(confluence).toHaveBeenCalledTimes(1);
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

  describe('list and deletion reads', () => {
    // R4: the draft list renders a publication badge per row. If that reused
    // findLatest, recoverPublicationFromSteps would run — and reconcile — once
    // per draft, turning a list render into N Atlassian calls.
    it('summarizes the latest publication without running step recovery', async () => {
      const harness = createHarness();
      const published = await publishConfluence(harness);
      const reconcile = jest.spyOn(harness.gateway, 'reconcileJiraChildTasks');
      const upsert = jest.spyOn(harness.gateway, 'upsertConfluenceBrief');
      harness.stepsRepository.find.mockClear();
      harness.publicationsRepository.query.mockClear();

      const summaries = await harness.service.findLatestStoredSummaries([
        DRAFT_ID,
      ]);

      expect(summaries.get(DRAFT_ID)).toEqual({
        draftId: DRAFT_ID,
        id: published.id,
        status: published.status,
        // The harness publishes in mock mode, so nothing exists externally.
        externalWritePerformed: false,
      });
      expect(harness.publicationsRepository.query).toHaveBeenCalledTimes(1);
      expect(harness.stepsRepository.find).not.toHaveBeenCalled();
      expect(reconcile).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
    });

    it('reads publications for every draft id in one query', async () => {
      const harness = createHarness();
      await publishConfluence(harness);
      harness.publicationsRepository.query.mockClear();

      const summaries = await harness.service.findLatestStoredSummaries([
        DRAFT_ID,
        '99999999-9999-4999-8999-999999999999',
      ]);

      expect(harness.publicationsRepository.query).toHaveBeenCalledTimes(1);
      expect(summaries.size).toBe(1);
    });

    it('does not query at all for an empty page', async () => {
      const harness = createHarness();
      harness.publicationsRepository.query.mockClear();

      await expect(
        harness.service.findLatestStoredSummaries([]),
      ).resolves.toEqual(new Map());
      expect(harness.publicationsRepository.query).not.toHaveBeenCalled();
    });

    it('reports a mock-mode publication as safe to delete', async () => {
      const harness = createHarness();
      await publishConfluence(harness);

      await expect(
        harness.service.assessDraftDeletion(DRAFT_ID),
      ).resolves.toEqual({ publishing: false, externalWritePerformed: false });
    });

    // R6: external write history is what makes deletion unsafe, and it must
    // be detected across every publication of the draft rather than only the
    // latest one — a later mock publication must not mask an earlier real page.
    it('reports external write history from any publication of the draft', async () => {
      const harness = createHarness();
      await publishConfluence(harness);
      harness.publications[0].executionMode = 'real';
      harness.publications[0].confluenceContentId = 'confluence-page-1';
      harness.publications.push({
        ...harness.publications[0],
        id: 'publication-later',
        executionMode: 'mock',
        confluenceContentId: null,
        createdAt: new Date(Date.now() + 1_000),
      });

      await expect(
        harness.service.assessDraftDeletion(DRAFT_ID),
      ).resolves.toMatchObject({ externalWritePerformed: true });
    });

    it('fails closed when a real provider result reached a step before the aggregate', async () => {
      const harness = createHarness();
      await publishConfluence(harness);
      harness.publications[0].executionMode = 'real';
      // Simulate a process exit after markSucceeded persisted this result and
      // before the aggregate save copied it to confluenceContentId.
      harness.publications[0].confluenceContentId = null;

      await expect(
        harness.service.assessDraftDeletion(DRAFT_ID),
      ).resolves.toMatchObject({ externalWritePerformed: true });
      await expect(
        harness.service.findLatestStoredSummaries([DRAFT_ID]),
      ).resolves.toEqual(
        new Map([
          [
            DRAFT_ID,
            expect.objectContaining({ externalWritePerformed: true }),
          ],
        ]),
      );
    });

    it('fails closed when step reconciliation is indeterminate', async () => {
      const harness = createHarness();
      await publishConfluence(harness);
      harness.publications[0].confluenceContentId = null;
      Object.assign(harness.steps[0], {
        status: 'NEEDS_REVIEW',
        providerObjectId: null,
        errorCode: 'PUBLICATION_RECONCILIATION_INDETERMINATE',
      });

      await expect(
        harness.service.assessDraftDeletion(DRAFT_ID),
      ).resolves.toMatchObject({ externalWritePerformed: true });
    });

    it('reports a running publication as blocking deletion', async () => {
      const harness = createHarness();
      await publishConfluence(harness);
      harness.publications[0].status = 'PUBLISHING';

      await expect(
        harness.service.assessDraftDeletion(DRAFT_ID),
      ).resolves.toMatchObject({ publishing: true });
    });

    it('reports a reserved pending publication as blocking deletion', async () => {
      const harness = createHarness();
      await publishConfluence(harness);
      harness.publications[0].status = 'PENDING';

      await expect(
        harness.service.assessDraftDeletion(DRAFT_ID),
      ).resolves.toMatchObject({ publishing: true });
    });
  });
});
