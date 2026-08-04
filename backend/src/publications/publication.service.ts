import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { IntegrationProfile } from '../integrations/profiles/entities/integration-profile.entity';
import { ReadinessService } from '../readiness/readiness.service';
import { WorkCopilotMetricsService } from '../operations/work-copilot-metrics.service';
import type {
  BriefChildTask,
  BriefContent,
} from '../work-briefs/brief-draft.types';
import { WorkBriefContentGuard } from '../work-briefs/work-brief-content-guard.service';
import { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';
import { BriefPublication } from './entities/brief-publication.entity';
import { PublicationStep } from './entities/publication-step.entity';
import {
  PublicationGatewayError,
  PUBLICATION_WRITE_GATEWAY,
  type PublicationWriteGateway,
  type PublicationWriteResult,
} from './publication-write-gateway';
import type {
  BriefPublicationView,
  PublicationErrorCode,
  PublicationStatus,
} from './publication.types';

const CONFLUENCE_STEP = 'confluence_page';
const REMOTE_LINK_STEP = 'jira_remote_link';
const SUMMARY_COMMENT_STEP = 'jira_summary_comment';
const CHILD_TASK_STEP_PREFIX = 'jira_child_task:';
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

type PublishInput = {
  draftVersion: number;
  approved: boolean;
  idempotencyKey: string | undefined;
};

type RetryInput = Omit<PublishInput, 'idempotencyKey'>;

@Injectable()
export class PublicationService {
  private readonly contentGuard = new WorkBriefContentGuard();

  constructor(
    @InjectRepository(WorkBriefDraft)
    private readonly draftsRepository: Repository<WorkBriefDraft>,
    @InjectRepository(IntegrationProfile)
    private readonly profilesRepository: Repository<IntegrationProfile>,
    @InjectRepository(BriefPublication)
    private readonly publicationsRepository: Repository<BriefPublication>,
    @InjectRepository(PublicationStep)
    private readonly stepsRepository: Repository<PublicationStep>,
    private readonly readinessService: ReadinessService,
    @Inject(PUBLICATION_WRITE_GATEWAY)
    private readonly writeGateway: PublicationWriteGateway,
    @Optional() private readonly metrics?: WorkCopilotMetricsService,
  ) {}

  async publish(
    userId: number,
    draftId: string,
    input: PublishInput,
    correlationId: string,
  ): Promise<BriefPublicationView> {
    this.assertApproval(input.approved);
    const idempotencyKeyHash = this.idempotencyKeyHash(
      userId,
      this.idempotencyKey(input.idempotencyKey),
    );
    const existing = await this.publicationsRepository.findOneBy({
      idempotencyKeyHash,
    });

    if (existing) {
      if (existing.draftId !== draftId) {
        throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED' });
      }
      await this.findOwnedDraft(userId, draftId);
      return this.present(existing);
    }

    const draft = await this.findOwnedDraft(userId, draftId);
    this.assertDraftVersion(draft, input.draftVersion);
    const existingForVersion = await this.publicationsRepository.findOneBy({
      draftId: draft.id,
      draftVersion: draft.optimisticVersion,
    });
    if (existingForVersion) {
      return this.present(existingForVersion);
    }
    await this.assertReadyForPublication(userId, draft, correlationId);
    const profile = await this.findActivePublishProfile(draft);
    this.assertSafeDraftContent(draft.maskedBrief);

    const publication = this.publicationsRepository.create({
      draftId: draft.id,
      operationId: randomUUID(),
      idempotencyKeyHash,
      draftVersion: draft.optimisticVersion,
      status: 'PENDING',
      confluenceContentId: null,
      jiraRemoteLinkId: null,
      approvedByUserId: userId,
      approvedAt: new Date(),
      executionMode: this.writeGateway.mode,
    });
    let stored: BriefPublication;
    try {
      stored = await this.publicationsRepository.save(publication);
    } catch (error) {
      if (!this.isDuplicateKeyError(error)) {
        throw error;
      }
      const concurrentPublication =
        (await this.publicationsRepository.findOneBy({
          idempotencyKeyHash,
        })) ??
        (await this.publicationsRepository.findOneBy({
          draftId: draft.id,
          draftVersion: draft.optimisticVersion,
        }));
      if (
        !concurrentPublication ||
        concurrentPublication.draftId !== draft.id
      ) {
        throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED' });
      }
      return this.present(concurrentPublication);
    }

    const steps = await this.createInitialSteps(stored, draft);
    return this.runSaga(stored, draft, profile, steps, userId, correlationId);
  }

  async findLatest(
    userId: number,
    draftId: string,
  ): Promise<BriefPublicationView> {
    await this.findOwnedDraft(userId, draftId);
    const publications = await this.publicationsRepository.find({
      where: { draftId },
      order: { createdAt: 'DESC' },
    });
    const publication = publications.at(0);

    if (!publication) {
      throw new NotFoundException('Brief publication was not found.');
    }

    return this.present(publication);
  }

  async retry(
    userId: number,
    draftId: string,
    publicationId: string,
    input: RetryInput,
    correlationId: string,
  ): Promise<BriefPublicationView> {
    this.assertApproval(input.approved);
    const draft = await this.findOwnedDraft(userId, draftId);
    this.assertDraftVersion(draft, input.draftVersion);
    const publication = await this.publicationsRepository.findOneBy({
      id: publicationId,
      draftId,
    });

    if (!publication) {
      throw new NotFoundException('Brief publication was not found.');
    }
    if (publication.draftVersion !== draft.optimisticVersion) {
      this.versionConflict(draft.optimisticVersion, publication.draftVersion);
    }
    if (publication.status === 'PUBLISHED') {
      return this.present(publication);
    }

    await this.assertReadyForPublication(userId, draft, correlationId);
    const profile = await this.findActivePublishProfile(draft);
    this.assertSafeDraftContent(draft.maskedBrief);
    const steps = await this.ensureSteps(publication, draft);
    return this.runSaga(
      publication,
      draft,
      profile,
      steps,
      userId,
      correlationId,
    );
  }

  private async runSaga(
    publication: BriefPublication,
    draft: WorkBriefDraft,
    profile: IntegrationProfile,
    steps: PublicationStep[],
    userId: number,
    correlationId: string,
  ): Promise<BriefPublicationView> {
    publication.status = 'PUBLISHING';
    publication.updatedAt = new Date();
    publication = await this.publicationsRepository.save(publication);

    const stepByKey = new Map(steps.map((step) => [step.stepKey, step]));
    const confluenceStep = this.requiredStep(stepByKey, CONFLUENCE_STEP);
    const existingContentId = await this.knownConfluenceContentId(publication);
    const confluenceContentId = await this.executeStep(confluenceStep, () =>
      this.writeGateway.upsertConfluenceBrief({
        userId,
        correlationId,
        profile,
        operationId: publication.operationId,
        parentPageId: profile.briefParentPageId as string,
        existingContentId,
        draftId: draft.id,
        sourceJiraKey: draft.sourceJiraKey,
        content: draft.maskedBrief,
        evidence: draft.evidence,
      }),
    );
    if (!confluenceContentId) {
      return this.finalize(publication, steps);
    }
    if (publication.confluenceContentId !== confluenceContentId) {
      publication.confluenceContentId = confluenceContentId;
      publication.updatedAt = new Date();
      publication = await this.publicationsRepository.save(publication);
    }

    const remoteLinkStep = this.requiredStep(stepByKey, REMOTE_LINK_STEP);
    const remoteLinkId = await this.executeStep(remoteLinkStep, () =>
      this.writeGateway.upsertJiraRemoteLink({
        userId,
        correlationId,
        profile,
        operationId: publication.operationId,
        sourceJiraId: draft.sourceJiraId,
        confluenceContentId,
        confluenceUrl: null,
        confluenceTitle: draft.maskedBrief.title.text,
      }),
    );
    if (!remoteLinkId) {
      return this.finalize(publication, steps);
    }
    if (publication.jiraRemoteLinkId !== remoteLinkId) {
      publication.jiraRemoteLinkId = remoteLinkId;
      publication.updatedAt = new Date();
      publication = await this.publicationsRepository.save(publication);
    }

    const summaryCommentStep = this.requiredStep(
      stepByKey,
      SUMMARY_COMMENT_STEP,
    );
    const summaryCommentId = await this.executeStep(summaryCommentStep, () =>
      this.writeGateway.createJiraSummaryComment({
        userId,
        correlationId,
        profile,
        operationId: publication.operationId,
        sourceJiraId: draft.sourceJiraId,
        summary: draft.maskedBrief.summary.text,
        confluenceContentId,
        confluenceUrl: null,
      }),
    );
    if (!summaryCommentId) {
      return this.finalize(publication, steps);
    }

    const template = profile.policy.childTaskTemplate;
    for (const childTask of this.selectedChildTasks(draft)) {
      const childTaskStep = this.requiredStep(
        stepByKey,
        this.childTaskStepKey(childTask),
      );
      if (!template) {
        throw new ConflictException({ code: 'CHILD_TASK_TEMPLATE_REQUIRED' });
      }
      await this.executeStep(childTaskStep, () =>
        this.writeGateway.createJiraChildTask({
          userId,
          correlationId,
          profile,
          operationId: publication.operationId,
          sourceJiraId: draft.sourceJiraId,
          sourceJiraKey: draft.sourceJiraKey,
          childTask,
          template,
        }),
      );
    }

    return this.finalize(publication, steps);
  }

  private async executeStep(
    step: PublicationStep,
    operation: () => Promise<PublicationWriteResult>,
  ): Promise<string | null> {
    if (step.status === 'SUCCEEDED' && step.providerObjectId) {
      return step.providerObjectId;
    }

    step.status = 'RUNNING';
    step.errorCode = null;
    step.attempts += 1;
    step.updatedAt = new Date();
    await this.stepsRepository.save(step);

    try {
      const result = await operation();
      if (!this.isWriteResult(result)) {
        const failure = this.failureFor(step.stepKey, null);
        throw new PublicationGatewayError(failure.code, true);
      }
      step.status = 'SUCCEEDED';
      step.providerObjectId = result.providerObjectId;
      step.errorCode = null;
      step.updatedAt = new Date();
      await this.stepsRepository.save(step);
      this.metrics?.increment('publication_stage_total', {
        stage: this.metricStage(step.stepKey),
        outcome: 'success',
      });
      return result.providerObjectId;
    } catch (error) {
      const failure = this.failureFor(step.stepKey, error);
      step.status = failure.retryable ? 'FAILED' : 'NEEDS_REVIEW';
      step.errorCode = failure.code;
      step.updatedAt = new Date();
      await this.stepsRepository.save(step);
      this.metrics?.increment('publication_stage_total', {
        stage: this.metricStage(step.stepKey),
        outcome: 'failure',
      });
      return null;
    }
  }

  private async finalize(
    publication: BriefPublication,
    steps: PublicationStep[],
  ): Promise<BriefPublicationView> {
    publication.status = this.statusFor(steps);
    publication.updatedAt = new Date();
    const saved = await this.publicationsRepository.save(publication);
    return this.present(saved, steps);
  }

  private statusFor(steps: readonly PublicationStep[]): PublicationStatus {
    if (steps.every((step) => step.status === 'SUCCEEDED')) {
      return 'PUBLISHED';
    }
    if (steps.some((step) => step.status === 'NEEDS_REVIEW')) {
      return 'NEEDS_REVIEW';
    }
    return 'PARTIALLY_PUBLISHED';
  }

  private async createInitialSteps(
    publication: BriefPublication,
    draft: WorkBriefDraft,
  ): Promise<PublicationStep[]> {
    return this.ensureSteps(publication, draft, []);
  }

  private async ensureSteps(
    publication: BriefPublication,
    draft: WorkBriefDraft,
    loadedSteps?: PublicationStep[],
  ): Promise<PublicationStep[]> {
    const existingSteps = loadedSteps ?? (await this.stepsFor(publication.id));
    const existingKeys = new Set(existingSteps.map((step) => step.stepKey));
    const keys = [
      CONFLUENCE_STEP,
      REMOTE_LINK_STEP,
      SUMMARY_COMMENT_STEP,
      ...this.selectedChildTasks(draft).map((task) =>
        this.childTaskStepKey(task),
      ),
    ];
    const missingKeys = keys.filter((key) => !existingKeys.has(key));
    if (missingKeys.length === 0) {
      return existingSteps;
    }
    const steps = missingKeys.map((stepKey) =>
      this.stepsRepository.create({
        publicationId: publication.id,
        stepKey,
        status: 'PENDING',
        attempts: 0,
        errorCode: null,
        providerObjectId: null,
      }),
    );

    const created = await this.stepsRepository.save(steps);
    return [...existingSteps, ...created];
  }

  private async stepsFor(publicationId: string): Promise<PublicationStep[]> {
    return this.stepsRepository.find({
      where: { publicationId },
      order: { createdAt: 'ASC' },
    });
  }

  private async knownConfluenceContentId(
    publication: BriefPublication,
  ): Promise<string | null> {
    if (publication.confluenceContentId) {
      return publication.confluenceContentId;
    }

    const publications = await this.publicationsRepository.find({
      where: { draftId: publication.draftId },
      order: { createdAt: 'DESC' },
    });
    return (
      publications.find(
        (candidate) =>
          candidate.id !== publication.id && !!candidate.confluenceContentId,
      )?.confluenceContentId ?? null
    );
  }

  private async present(
    publication: BriefPublication,
    loadedSteps?: PublicationStep[],
  ): Promise<BriefPublicationView> {
    const steps = loadedSteps ?? (await this.stepsFor(publication.id));
    const requiresReview =
      Boolean(publication.reviewRequiredAt) ||
      steps.some((step) => step.status === 'NEEDS_REVIEW');
    const canRetry = publication.status !== 'PUBLISHED';

    return {
      id: publication.id,
      draftId: publication.draftId,
      draftVersion: publication.draftVersion,
      status: publication.status,
      executionMode: publication.executionMode,
      externalWritePerformed: false,
      canRetry,
      requiresReview,
      steps: steps.map((step) => ({
        key: step.stepKey,
        status: step.status,
        attempts: step.attempts,
        errorCode: step.errorCode,
        retryable: step.status === 'FAILED',
      })),
      updatedAt: publication.updatedAt,
    };
  }

  private async assertReadyForPublication(
    userId: number,
    draft: WorkBriefDraft,
    correlationId: string,
  ): Promise<void> {
    await this.readinessService.assertDraftPublishAllowed(
      userId,
      draft.id,
      correlationId,
    );
  }

  private async findActivePublishProfile(
    draft: WorkBriefDraft,
  ): Promise<IntegrationProfile> {
    const profile = await this.profilesRepository.findOneBy({
      id: draft.profileId,
      isActive: true,
    });
    if (!profile || !profile.briefParentPageId?.trim()) {
      throw new ConflictException({ code: 'PUBLISH_PARENT_PAGE_REQUIRED' });
    }
    return profile;
  }

  private async findOwnedDraft(
    userId: number,
    draftId: string,
  ): Promise<WorkBriefDraft> {
    const draft = await this.draftsRepository.findOneBy({
      id: draftId,
      createdByUserId: userId,
    });
    if (!draft) {
      throw new NotFoundException('Brief draft was not found.');
    }
    return draft;
  }

  private requiredStep(
    stepByKey: ReadonlyMap<string, PublicationStep>,
    stepKey: string,
  ): PublicationStep {
    const step = stepByKey.get(stepKey);
    if (!step) {
      throw new ConflictException({ code: 'PUBLICATION_STEPS_INVALID' });
    }
    return step;
  }

  private selectedChildTasks(draft: WorkBriefDraft): BriefChildTask[] {
    return draft.maskedBrief.childTasks.filter((task) => task.selected);
  }

  private childTaskStepKey(task: Pick<BriefChildTask, 'clientTaskId'>): string {
    return `${CHILD_TASK_STEP_PREFIX}${task.clientTaskId}`;
  }

  private metricStage(
    stepKey: string,
  ):
    | 'confluence_page'
    | 'jira_remote_link'
    | 'jira_summary_comment'
    | 'jira_child_task' {
    if (stepKey === CONFLUENCE_STEP) {
      return 'confluence_page';
    }
    if (stepKey === REMOTE_LINK_STEP) {
      return 'jira_remote_link';
    }
    if (stepKey === SUMMARY_COMMENT_STEP) {
      return 'jira_summary_comment';
    }
    return 'jira_child_task';
  }

  private assertSafeDraftContent(content: BriefContent): void {
    this.contentGuard.assertSafeModelOutput([
      content.title.text,
      content.summary.text,
      ...content.requirements.map((item) => item.text),
      ...content.acceptanceCriteria.map((item) => item.text),
      ...content.risks.map((item) => item.text),
      ...content.nextSteps.map((item) => item.text),
      ...content.childTasks.flatMap((item) => [item.text, item.summary]),
    ]);
  }

  private assertApproval(approved: boolean): void {
    if (!approved) {
      throw new ConflictException({ code: 'DRAFT_APPROVAL_REQUIRED' });
    }
  }

  private assertDraftVersion(
    draft: WorkBriefDraft,
    expectedVersion: number,
  ): void {
    if (draft.optimisticVersion !== expectedVersion) {
      this.versionConflict(draft.optimisticVersion, expectedVersion);
    }
  }

  private versionConflict(
    currentVersion: number,
    expectedVersion: number,
  ): never {
    throw new ConflictException({
      code: 'DRAFT_VERSION_CONFLICT',
      currentVersion,
      expectedVersion,
    });
  }

  private idempotencyKey(value: string | undefined): string {
    const normalized = value?.trim();
    if (!normalized || normalized.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new BadRequestException('Idempotency-Key is required.');
    }
    return normalized;
  }

  private idempotencyKeyHash(userId: number, key: string): string {
    return createHash('sha256').update(`${userId}:${key}`).digest('hex');
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505'
    );
  }

  private isWriteResult(value: unknown): value is PublicationWriteResult {
    return (
      typeof value === 'object' &&
      value !== null &&
      'providerObjectId' in value &&
      typeof (value as { providerObjectId?: unknown }).providerObjectId ===
        'string' &&
      (value as { providerObjectId: string }).providerObjectId.length > 0
    );
  }

  private failureFor(
    stepKey: string,
    error: unknown,
  ): { code: PublicationErrorCode; retryable: boolean } {
    if (error instanceof PublicationGatewayError) {
      return { code: error.code, retryable: error.retryable };
    }

    if (stepKey === CONFLUENCE_STEP) {
      return { code: 'CONFLUENCE_WRITE_FAILED', retryable: true };
    }
    if (stepKey === REMOTE_LINK_STEP) {
      return { code: 'JIRA_REMOTE_LINK_FAILED', retryable: true };
    }
    if (stepKey === SUMMARY_COMMENT_STEP) {
      return { code: 'JIRA_SUMMARY_COMMENT_FAILED', retryable: true };
    }
    return { code: 'JIRA_CHILD_TASK_FAILED', retryable: true };
  }
}
