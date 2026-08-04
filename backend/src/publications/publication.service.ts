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
import { WorkCopilotMetricsService } from '../operations/work-copilot-metrics.service';
import { ReadinessService } from '../readiness/readiness.service';
import type {
  BriefChildTask,
  BriefContent,
} from '../work-briefs/brief-draft.types';
import { WorkBriefContentGuard } from '../work-briefs/work-brief-content-guard.service';
import { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';
import { BriefPublication } from './entities/brief-publication.entity';
import { PublicationStep } from './entities/publication-step.entity';
import { PublicationStepClaimerService } from './publication-step-claimer.service';
import {
  PublicationGatewayError,
  PUBLICATION_WRITE_GATEWAY,
  type PublicationWriteGateway,
  type PublicationWriteResult,
} from './publication-write-gateway';
import {
  type ChildTasksPublicationPreview,
  type ConfluencePublicationPreview,
  type JiraPublicationPreview,
  PublicationPreviewService,
} from './publication-preview.service';
import type {
  BriefPublicationView,
  PublicationErrorCode,
  PublicationPhase,
  PublicationStatus,
} from './publication.types';

const CONFLUENCE_STEP = 'confluence_page';
const REMOTE_LINK_STEP = 'jira_remote_link';
const SUMMARY_COMMENT_STEP = 'jira_summary_comment';
const CHILD_TASK_STEP_PREFIX = 'jira_child_task:';
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

type PhaseInput = {
  draftVersion: number;
  previewHash: string;
  approved: boolean;
  idempotencyKey: string | undefined;
};

type RetryInput = PhaseInput & { phase: PublicationPhase };

type StepExecution =
  | { outcome: 'succeeded'; result: PublicationWriteResult }
  | { outcome: 'failed' }
  | { outcome: 'in_progress' };

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
    private readonly previewService: PublicationPreviewService,
    @Inject(PUBLICATION_WRITE_GATEWAY)
    private readonly writeGateway: PublicationWriteGateway,
    private readonly stepClaimer: PublicationStepClaimerService,
    @Optional() private readonly metrics?: WorkCopilotMetricsService,
  ) {}

  async previewConfluence(
    userId: number,
    draftId: string,
    correlationId: string,
  ): Promise<ConfluencePublicationPreview> {
    const draft = await this.findOwnedDraft(userId, draftId);
    const profile = await this.findActivePublishProfile(draft);
    this.assertSafeDraftContent(draft.maskedBrief);
    return this.previewService.confluence(
      userId,
      draft,
      profile,
      correlationId,
    );
  }

  async publish(
    userId: number,
    draftId: string,
    input: PhaseInput,
    correlationId: string,
  ): Promise<BriefPublicationView> {
    this.assertApproval(input.approved);
    const draft = await this.findOwnedDraft(userId, draftId);
    const idempotencyKeyHash = this.idempotencyKeyHash(
      userId,
      this.idempotencyKey(input.idempotencyKey),
    );
    const existingByKey = await this.publicationsRepository.findOneBy({
      idempotencyKeyHash,
    });
    if (existingByKey) {
      if (existingByKey.draftId !== draft.id) {
        throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED' });
      }
      const recovered = await this.recoverPublicationFromSteps(
        existingByKey,
        draft,
      );
      return this.present(recovered.publication, recovered.steps);
    }
    const existingForVersion = await this.publicationsRepository.findOneBy({
      draftId: draft.id,
      draftVersion: draft.optimisticVersion,
    });
    if (existingForVersion) {
      const recovered = await this.recoverPublicationFromSteps(
        existingForVersion,
        draft,
      );
      return this.present(recovered.publication, recovered.steps);
    }

    this.assertDraftVersion(draft, input.draftVersion);
    await this.assertReadyForPublication(userId, draft, correlationId);
    const profile = await this.findActivePublishProfile(draft);
    this.assertSafeDraftContent(draft.maskedBrief);
    const preview = await this.previewService.confluence(
      userId,
      draft,
      profile,
      correlationId,
    );
    this.assertPreview(input.previewHash, preview.previewHash);

    const now = new Date();
    const publication = this.publicationsRepository.create({
      draftId: draft.id,
      operationId: randomUUID(),
      idempotencyKeyHash,
      draftVersion: draft.optimisticVersion,
      status: 'PENDING',
      confluenceContentId: null,
      jiraRemoteLinkId: null,
      jiraSummaryCommentId: null,
      confluencePageVersion: null,
      confluencePageUrl: null,
      confluenceContentHash: null,
      requestedByUserId: userId,
      requestedAt: now,
      approvedByUserId: userId,
      approvedAt: now,
      jiraIdempotencyKeyHash: null,
      childTasksIdempotencyKeyHash: null,
      confluencePreviewHash: preview.previewHash,
      jiraPreviewHash: null,
      childTasksPreviewHash: null,
      jiraApprovedByUserId: null,
      jiraApprovedAt: null,
      childTasksApprovedByUserId: null,
      childTasksApprovedAt: null,
      executionMode: this.writeGateway.mode,
      reviewRequiredAt: null,
    });
    let stored: BriefPublication;
    try {
      stored = await this.publicationsRepository.save(publication);
    } catch (error) {
      if (!this.isDuplicateKeyError(error)) {
        throw error;
      }
      const concurrent =
        (await this.publicationsRepository.findOneBy({
          idempotencyKeyHash,
        })) ??
        (await this.publicationsRepository.findOneBy({
          draftId: draft.id,
          draftVersion: draft.optimisticVersion,
        }));
      if (!concurrent || concurrent.draftId !== draft.id) {
        throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED' });
      }
      const recovered = await this.recoverPublicationFromSteps(
        concurrent,
        draft,
      );
      return this.present(recovered.publication, recovered.steps);
    }

    const steps = await this.ensureSteps(stored, 'confluence', []);
    return this.runConfluence(
      stored,
      draft,
      profile,
      steps,
      userId,
      correlationId,
      preview,
    );
  }

  async previewJira(
    userId: number,
    draftId: string,
    publicationId: string,
  ): Promise<JiraPublicationPreview> {
    const draft = await this.findOwnedDraft(userId, draftId);
    const publication = await this.findPublication(draft, publicationId);
    const recovered = await this.recoverPublicationFromSteps(
      publication,
      draft,
    );
    this.assertPublicationDraftVersion(recovered.publication, draft);
    this.assertConfluenceSucceeded(recovered.steps);
    return this.previewService.jira(draft, recovered.publication);
  }

  async publishJira(
    userId: number,
    draftId: string,
    publicationId: string,
    input: PhaseInput,
    correlationId: string,
  ): Promise<BriefPublicationView> {
    this.assertApproval(input.approved);
    const draft = await this.findOwnedDraft(userId, draftId);
    let publication = await this.findPublication(draft, publicationId);
    const idempotencyKeyHash = this.idempotencyKeyHash(
      userId,
      this.idempotencyKey(input.idempotencyKey),
    );
    const recovered = await this.recoverPublicationFromSteps(
      publication,
      draft,
    );
    publication = recovered.publication;
    const steps = recovered.steps;
    if (this.phaseSucceeded(steps, 'jira')) {
      return this.present(publication, steps);
    }
    this.assertDraftVersion(draft, input.draftVersion);
    this.assertPublicationDraftVersion(publication, draft);
    this.assertConfluenceSucceeded(steps);
    await this.assertReadyForPublication(userId, draft, correlationId);
    const profile = await this.findActivePublishProfile(draft);
    this.assertSafeDraftContent(draft.maskedBrief);
    const preview = this.previewService.jira(draft, publication);
    this.assertPreview(input.previewHash, preview.previewHash);
    publication.jiraIdempotencyKeyHash = idempotencyKeyHash;
    publication.jiraPreviewHash = preview.previewHash;
    publication.jiraApprovedByUserId = userId;
    publication.jiraApprovedAt = new Date();
    publication.updatedAt = new Date();
    const saved = await this.savePhaseApproval(publication, 'jira');
    const phaseSteps = await this.ensureSteps(saved, 'jira', steps);
    return this.runJira(
      saved,
      draft,
      profile,
      phaseSteps,
      userId,
      correlationId,
      preview,
    );
  }

  async previewChildTasks(
    userId: number,
    draftId: string,
    publicationId: string,
    correlationId: string,
  ): Promise<ChildTasksPublicationPreview> {
    const draft = await this.findOwnedDraft(userId, draftId);
    const publication = await this.findPublication(draft, publicationId);
    const recovered = await this.recoverPublicationFromSteps(
      publication,
      draft,
    );
    this.assertPublicationDraftVersion(recovered.publication, draft);
    this.assertJiraSucceeded(recovered.steps);
    // This readiness pass checks Jira createmeta before the user sees the
    // irreversible child-task approval screen. It runs again immediately
    // before execution so a changed provider configuration cannot bypass it.
    await this.assertReadyForPublication(userId, draft, correlationId);
    const profile = await this.findActivePublishProfile(draft);
    return this.previewService.childTasks(
      draft,
      recovered.publication,
      profile,
    );
  }

  async publishChildTasks(
    userId: number,
    draftId: string,
    publicationId: string,
    input: PhaseInput,
    correlationId: string,
  ): Promise<BriefPublicationView> {
    this.assertApproval(input.approved);
    const draft = await this.findOwnedDraft(userId, draftId);
    let publication = await this.findPublication(draft, publicationId);
    const idempotencyKeyHash = this.idempotencyKeyHash(
      userId,
      this.idempotencyKey(input.idempotencyKey),
    );
    const recovered = await this.recoverPublicationFromSteps(
      publication,
      draft,
    );
    publication = recovered.publication;
    const steps = recovered.steps;
    if (this.phaseSucceeded(steps, 'child_tasks')) {
      return this.present(publication, steps);
    }
    this.assertDraftVersion(draft, input.draftVersion);
    this.assertPublicationDraftVersion(publication, draft);
    this.assertJiraSucceeded(steps);
    await this.assertReadyForPublication(userId, draft, correlationId);
    const profile = await this.findActivePublishProfile(draft);
    this.assertSafeDraftContent(draft.maskedBrief);
    const preview = this.previewService.childTasks(draft, publication, profile);
    this.assertPreview(input.previewHash, preview.previewHash);
    publication.childTasksIdempotencyKeyHash = idempotencyKeyHash;
    publication.childTasksPreviewHash = preview.previewHash;
    publication.childTasksApprovedByUserId = userId;
    publication.childTasksApprovedAt = new Date();
    publication.updatedAt = new Date();
    const saved = await this.savePhaseApproval(publication, 'child_tasks');
    const phaseSteps = await this.ensureSteps(
      saved,
      'child_tasks',
      steps,
      draft.maskedBrief.childTasks.filter((task) => task.selected),
      idempotencyKeyHash,
    );
    return this.runChildTasks(
      saved,
      draft,
      profile,
      phaseSteps,
      userId,
      correlationId,
      preview,
    );
  }

  async retry(
    userId: number,
    draftId: string,
    publicationId: string,
    input: RetryInput,
    correlationId: string,
  ): Promise<BriefPublicationView> {
    switch (input.phase) {
      case 'jira':
        return this.publishJira(
          userId,
          draftId,
          publicationId,
          input,
          correlationId,
        );
      case 'child_tasks':
        return this.publishChildTasks(
          userId,
          draftId,
          publicationId,
          input,
          correlationId,
        );
      case 'confluence':
        return this.retryConfluence(
          userId,
          draftId,
          publicationId,
          input,
          correlationId,
        );
    }
  }

  async findLatest(
    userId: number,
    draftId: string,
  ): Promise<BriefPublicationView> {
    const draft = await this.findOwnedDraft(userId, draftId);
    const publications = await this.publicationsRepository.find({
      where: { draftId },
      order: { createdAt: 'DESC' },
    });
    const publication = publications.at(0);
    if (!publication) {
      throw new NotFoundException('Brief publication was not found.');
    }
    const recovered = await this.recoverPublicationFromSteps(
      publication,
      draft,
    );
    return this.present(recovered.publication, recovered.steps);
  }

  private async retryConfluence(
    userId: number,
    draftId: string,
    publicationId: string,
    input: PhaseInput,
    correlationId: string,
  ): Promise<BriefPublicationView> {
    this.assertApproval(input.approved);
    const draft = await this.findOwnedDraft(userId, draftId);
    let publication = await this.findPublication(draft, publicationId);
    // A retry key protects one HTTP command. The durable publication ID and
    // step state identify the incomplete operation across browser sessions.
    this.idempotencyKey(input.idempotencyKey);
    const recovered = await this.recoverPublicationFromSteps(
      publication,
      draft,
    );
    publication = recovered.publication;
    const existingSteps = recovered.steps;
    if (this.phaseSucceeded(existingSteps, 'confluence')) {
      return this.present(publication, existingSteps);
    }
    this.assertDraftVersion(draft, input.draftVersion);
    this.assertPublicationDraftVersion(publication, draft);
    await this.assertReadyForPublication(userId, draft, correlationId);
    const profile = await this.findActivePublishProfile(draft);
    this.assertSafeDraftContent(draft.maskedBrief);
    const preview = await this.previewService.confluence(
      userId,
      draft,
      profile,
      correlationId,
    );
    this.assertPreview(input.previewHash, preview.previewHash);
    const steps = await this.ensureSteps(
      publication,
      'confluence',
      existingSteps,
    );
    return this.runConfluence(
      publication,
      draft,
      profile,
      steps,
      userId,
      correlationId,
      preview,
    );
  }

  private async runConfluence(
    publication: BriefPublication,
    draft: WorkBriefDraft,
    profile: IntegrationProfile,
    steps: PublicationStep[],
    userId: number,
    correlationId: string,
    preview: ConfluencePublicationPreview,
  ): Promise<BriefPublicationView> {
    publication.status = 'PUBLISHING';
    publication.updatedAt = new Date();
    publication = await this.publicationsRepository.save(publication);
    const step = this.requiredStep(steps, CONFLUENCE_STEP);
    const execution = await this.executeStep(step, () =>
      this.writeGateway.upsertConfluenceBrief({
        userId,
        correlationId,
        profile,
        operationId: publication.operationId,
        parentPageId: profile.briefParentPageId as string,
        existingContentId: publication.confluenceContentId,
        draftId: draft.id,
        sourceJiraKey: draft.sourceJiraKey,
        content: draft.maskedBrief,
        evidence: draft.evidence,
      }),
    );
    if (execution.outcome === 'in_progress') {
      return this.present(publication);
    }
    if (execution.outcome === 'succeeded') {
      // The canonical Confluence content hash is part of the recovery record,
      // including for the in-memory adapter used by tests.
      if (!step.contentHash) {
        step.contentHash = execution.result.contentHash ?? preview.contentHash;
        step.updatedAt = new Date();
        await this.stepsRepository.save(step);
      }
      if (this.applyStepResult(publication, step)) {
        publication.updatedAt = new Date();
        publication = await this.publicationsRepository.save(publication);
      }
    }
    return this.finalize(publication, steps, 'confluence', draft);
  }

  private async runJira(
    publication: BriefPublication,
    draft: WorkBriefDraft,
    profile: IntegrationProfile,
    steps: PublicationStep[],
    userId: number,
    correlationId: string,
    preview: JiraPublicationPreview,
  ): Promise<BriefPublicationView> {
    publication.status = 'PUBLISHING';
    publication.updatedAt = new Date();
    publication = await this.publicationsRepository.save(publication);
    const remoteLink = this.requiredStep(steps, REMOTE_LINK_STEP);
    const linkExecution = await this.executeStep(remoteLink, () =>
      this.writeGateway.upsertJiraRemoteLink({
        userId,
        correlationId,
        profile,
        operationId: publication.operationId,
        sourceJiraId: draft.sourceJiraId,
        confluenceContentId: preview.confluencePage.id,
        confluenceUrl: preview.confluencePage.url,
        confluenceTitle: preview.confluencePage.title,
      }),
    );
    if (linkExecution.outcome === 'in_progress') {
      return this.present(publication);
    }
    if (linkExecution.outcome === 'failed') {
      return this.finalize(publication, steps, 'jira', draft);
    }
    if (this.applyStepResult(publication, remoteLink)) {
      publication.updatedAt = new Date();
      publication = await this.publicationsRepository.save(publication);
    }

    const comment = this.requiredStep(steps, SUMMARY_COMMENT_STEP);
    const commentExecution = await this.executeStep(comment, () =>
      this.writeGateway.createJiraSummaryComment({
        userId,
        correlationId,
        profile,
        operationId: publication.operationId,
        sourceJiraId: draft.sourceJiraId,
        summary: draft.maskedBrief.summary.text,
        confluenceContentId: preview.confluencePage.id,
        confluenceUrl: preview.confluencePage.url,
      }),
    );
    if (commentExecution.outcome === 'in_progress') {
      return this.present(publication);
    }
    if (
      commentExecution.outcome === 'succeeded' &&
      this.applyStepResult(publication, comment)
    ) {
      publication.updatedAt = new Date();
      publication = await this.publicationsRepository.save(publication);
    }
    return this.finalize(publication, steps, 'jira', draft);
  }

  private async runChildTasks(
    publication: BriefPublication,
    draft: WorkBriefDraft,
    profile: IntegrationProfile,
    steps: PublicationStep[],
    userId: number,
    correlationId: string,
    preview: ChildTasksPublicationPreview,
  ): Promise<BriefPublicationView> {
    publication.status = 'PUBLISHING';
    publication.updatedAt = new Date();
    publication = await this.publicationsRepository.save(publication);
    const template = profile.policy.childTaskTemplate;
    if (!template && preview.childTasks.length > 0) {
      throw new ConflictException({ code: 'CHILD_TASK_TEMPLATE_REQUIRED' });
    }
    for (const childTask of this.selectedChildTasks(draft)) {
      const step = this.requiredStep(steps, this.childTaskStepKey(childTask));
      const execution = await this.executeStep(step, () =>
        this.writeGateway.createJiraChildTask({
          userId,
          correlationId,
          profile,
          operationId: publication.operationId,
          sourceJiraId: draft.sourceJiraId,
          sourceJiraKey: draft.sourceJiraKey,
          childTask,
          template: template as NonNullable<typeof template>,
        }),
      );
      if (execution.outcome === 'in_progress') {
        return this.present(publication);
      }
    }
    return this.finalize(publication, steps, 'child_tasks', draft);
  }

  private async executeStep(
    step: PublicationStep,
    operation: () => Promise<PublicationWriteResult>,
  ): Promise<StepExecution> {
    const existing = this.writeResultFromStep(step);
    if (existing) {
      return { outcome: 'succeeded', result: existing };
    }
    if (!(await this.stepClaimer.claim(step.id))) {
      return { outcome: 'in_progress' };
    }

    step.status = 'RUNNING';
    step.errorCode = null;
    step.attempts += 1;
    step.executionLeaseExpiresAt = new Date(Date.now() + 30_000);
    step.updatedAt = new Date();

    let result: PublicationWriteResult;
    try {
      result = await operation();
      if (!this.isWriteResult(result)) {
        throw new PublicationGatewayError(
          this.failureFor(step.stepKey, null).code,
          true,
        );
      }
    } catch (error) {
      const failure = this.failureFor(step.stepKey, error);
      step.status = failure.retryable ? 'FAILED' : 'NEEDS_REVIEW';
      step.errorCode = failure.code;
      step.executionLeaseExpiresAt = null;
      step.updatedAt = new Date();
      await this.stepsRepository.save(step);
      this.metrics?.increment('publication_stage_total', {
        stage: this.metricStage(step.stepKey),
        outcome: 'failure',
      });
      return { outcome: 'failed' };
    }

    step.status = 'SUCCEEDED';
    step.providerObjectId = result.providerObjectId;
    step.providerObjectVersion = result.providerObjectVersion ?? null;
    step.providerUrl = result.providerUrl ?? null;
    step.contentHash = result.contentHash ?? null;
    step.errorCode = null;
    step.executionLeaseExpiresAt = null;
    step.updatedAt = new Date();
    await this.stepsRepository.save(step);
    this.metrics?.increment('publication_stage_total', {
      stage: this.metricStage(step.stepKey),
      outcome: 'success',
    });
    return { outcome: 'succeeded', result };
  }

  private async finalize(
    publication: BriefPublication,
    steps: PublicationStep[],
    phase: PublicationPhase,
    draft: WorkBriefDraft,
  ): Promise<BriefPublicationView> {
    const currentSteps = await this.stepsFor(publication.id);
    publication.status = this.statusFor(currentSteps, phase, draft);
    publication.updatedAt = new Date();
    const saved = await this.publicationsRepository.save(publication);
    return this.present(saved, currentSteps);
  }

  private statusFor(
    steps: readonly PublicationStep[],
    phase: PublicationPhase,
    draft: WorkBriefDraft,
  ): PublicationStatus {
    const phaseSteps = steps.filter((step) => step.phase === phase);
    if (phaseSteps.some((step) => step.status === 'NEEDS_REVIEW')) {
      return 'NEEDS_REVIEW';
    }
    if (phaseSteps.some((step) => step.status === 'RUNNING')) {
      return 'PUBLISHING';
    }
    if (phaseSteps.some((step) => step.status !== 'SUCCEEDED')) {
      return 'PARTIALLY_PUBLISHED';
    }
    if (phase === 'confluence') {
      return 'CONFLUENCE_PUBLISHED';
    }
    if (phase === 'jira') {
      return this.selectedChildTasks(draft).length === 0
        ? 'PUBLISHED'
        : 'JIRA_PUBLISHED';
    }
    return 'PUBLISHED';
  }

  private async ensureSteps(
    publication: BriefPublication,
    phase: PublicationPhase,
    loadedSteps?: PublicationStep[],
    childTasks: readonly BriefChildTask[] = [],
    childTaskIdempotencyKeyHash: string | null = null,
  ): Promise<PublicationStep[]> {
    const existing = loadedSteps ?? (await this.stepsFor(publication.id));
    const keys = this.stepKeys(phase, childTasks);
    const existingKeys = new Set(existing.map((step) => step.stepKey));
    const missing = keys.filter((key) => !existingKeys.has(key));
    if (missing.length === 0) {
      return existing;
    }
    const created = await this.stepsRepository.save(
      missing.map((stepKey) =>
        this.stepsRepository.create({
          publicationId: publication.id,
          stepKey,
          phase,
          status: 'PENDING',
          attempts: 0,
          errorCode: null,
          providerObjectId: null,
          providerObjectVersion: null,
          providerUrl: null,
          contentHash: null,
          executionLeaseExpiresAt: null,
          idempotencyKeyHash:
            phase === 'child_tasks' && childTaskIdempotencyKeyHash
              ? this.childTaskIdempotencyHash(
                  childTaskIdempotencyKeyHash,
                  stepKey,
                )
              : null,
        }),
      ),
    );
    return [...existing, ...created];
  }

  private stepKeys(
    phase: PublicationPhase,
    childTasks: readonly BriefChildTask[],
  ): string[] {
    if (phase === 'confluence') {
      return [CONFLUENCE_STEP];
    }
    if (phase === 'jira') {
      return [REMOTE_LINK_STEP, SUMMARY_COMMENT_STEP];
    }
    return childTasks.map((task) => this.childTaskStepKey(task));
  }

  private async stepsFor(publicationId: string): Promise<PublicationStep[]> {
    return this.stepsRepository.find({
      where: { publicationId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * External writes are durable in the step record before this aggregate is
   * updated. Rehydrate the aggregate from that durable result after a crash
   * between the two saves.
   */
  private async recoverPublicationFromSteps(
    publication: BriefPublication,
    draft: WorkBriefDraft,
    loadedSteps?: PublicationStep[],
  ): Promise<{ publication: BriefPublication; steps: PublicationStep[] }> {
    const steps = loadedSteps ?? (await this.stepsFor(publication.id));
    let changed = false;

    for (const step of steps) {
      changed = this.applyStepResult(publication, step) || changed;
    }

    const phase = this.latestPhase(steps);
    const recoveredStatus = this.statusFor(steps, phase, draft);
    if (publication.status !== recoveredStatus) {
      publication.status = recoveredStatus;
      changed = true;
    }

    if (!changed) {
      return { publication, steps };
    }

    publication.updatedAt = new Date();
    return {
      publication: await this.publicationsRepository.save(publication),
      steps,
    };
  }

  private latestPhase(steps: readonly PublicationStep[]): PublicationPhase {
    if (steps.some((step) => step.phase === 'child_tasks')) {
      return 'child_tasks';
    }
    if (steps.some((step) => step.phase === 'jira')) {
      return 'jira';
    }
    return 'confluence';
  }

  private applyStepResult(
    publication: BriefPublication,
    step: PublicationStep,
  ): boolean {
    if (step.status !== 'SUCCEEDED' || !step.providerObjectId) {
      return false;
    }

    let changed = false;
    if (step.stepKey === CONFLUENCE_STEP) {
      if (publication.confluenceContentId !== step.providerObjectId) {
        publication.confluenceContentId = step.providerObjectId;
        changed = true;
      }
      if (
        step.providerObjectVersion !== null &&
        publication.confluencePageVersion !== step.providerObjectVersion
      ) {
        publication.confluencePageVersion = step.providerObjectVersion;
        changed = true;
      }
      if (
        step.providerUrl !== null &&
        publication.confluencePageUrl !== step.providerUrl
      ) {
        publication.confluencePageUrl = step.providerUrl;
        changed = true;
      }
      if (
        step.contentHash !== null &&
        publication.confluenceContentHash !== step.contentHash
      ) {
        publication.confluenceContentHash = step.contentHash;
        changed = true;
      }
      return changed;
    }

    if (
      step.stepKey === REMOTE_LINK_STEP &&
      publication.jiraRemoteLinkId !== step.providerObjectId
    ) {
      publication.jiraRemoteLinkId = step.providerObjectId;
      return true;
    }

    if (
      step.stepKey === SUMMARY_COMMENT_STEP &&
      publication.jiraSummaryCommentId !== step.providerObjectId
    ) {
      publication.jiraSummaryCommentId = step.providerObjectId;
      return true;
    }

    return false;
  }

  private writeResultFromStep(
    step: PublicationStep,
  ): PublicationWriteResult | null {
    if (step.status !== 'SUCCEEDED' || !step.providerObjectId) {
      return null;
    }
    return {
      providerObjectId: step.providerObjectId,
      ...(step.providerObjectVersion
        ? { providerObjectVersion: step.providerObjectVersion }
        : {}),
      ...(step.providerUrl ? { providerUrl: step.providerUrl } : {}),
      ...(step.contentHash ? { contentHash: step.contentHash } : {}),
    };
  }

  private requiredStep(
    steps: readonly PublicationStep[],
    stepKey: string,
  ): PublicationStep {
    const step = steps.find((candidate) => candidate.stepKey === stepKey);
    if (!step) {
      throw new ConflictException({ code: 'PUBLICATION_STEPS_INVALID' });
    }
    return step;
  }

  private assertConfluenceSucceeded(steps: readonly PublicationStep[]): void {
    if (
      steps.find((step) => step.stepKey === CONFLUENCE_STEP)?.status !==
      'SUCCEEDED'
    ) {
      throw new ConflictException({ code: 'CONFLUENCE_PUBLICATION_REQUIRED' });
    }
  }

  private assertJiraSucceeded(steps: readonly PublicationStep[]): void {
    if (
      [REMOTE_LINK_STEP, SUMMARY_COMMENT_STEP].some(
        (key) =>
          steps.find((step) => step.stepKey === key)?.status !== 'SUCCEEDED',
      )
    ) {
      throw new ConflictException({ code: 'JIRA_PUBLICATION_REQUIRED' });
    }
  }

  private phaseSucceeded(
    steps: readonly PublicationStep[],
    phase: PublicationPhase,
  ): boolean {
    const phaseSteps = steps.filter((step) => step.phase === phase);
    return (
      phaseSteps.length > 0 &&
      phaseSteps.every((step) => step.status === 'SUCCEEDED')
    );
  }

  private selectedChildTasks(draft: WorkBriefDraft): BriefChildTask[] {
    return draft.maskedBrief.childTasks.filter((task) => task.selected);
  }

  private childTaskStepKey(task: Pick<BriefChildTask, 'clientTaskId'>): string {
    return `${CHILD_TASK_STEP_PREFIX}${task.clientTaskId}`;
  }

  private childTaskIdempotencyHash(baseHash: string, stepKey: string): string {
    return createHash('sha256').update(`${baseHash}:${stepKey}`).digest('hex');
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

  private async findPublication(
    draft: WorkBriefDraft,
    publicationId: string,
  ): Promise<BriefPublication> {
    const publication = await this.publicationsRepository.findOneBy({
      id: publicationId,
      draftId: draft.id,
    });
    if (!publication) {
      throw new NotFoundException('Brief publication was not found.');
    }
    return publication;
  }

  private assertPublicationDraftVersion(
    publication: BriefPublication,
    draft: WorkBriefDraft,
  ): void {
    if (publication.draftVersion !== draft.optimisticVersion) {
      this.versionConflict(draft.optimisticVersion, publication.draftVersion);
    }
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

  private assertPreview(provided: string, expected: string): void {
    if (!provided || provided !== expected) {
      throw new ConflictException({ code: 'PUBLICATION_PREVIEW_STALE' });
    }
  }

  private async savePhaseApproval(
    publication: BriefPublication,
    phase: Exclude<PublicationPhase, 'confluence'>,
  ): Promise<BriefPublication> {
    try {
      return await this.publicationsRepository.save(publication);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          phase,
        });
      }
      throw error;
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

  private async present(
    publication: BriefPublication,
    loadedSteps?: PublicationStep[],
  ): Promise<BriefPublicationView> {
    const steps = loadedSteps ?? (await this.stepsFor(publication.id));
    const requiresReview =
      Boolean(publication.reviewRequiredAt) ||
      steps.some((step) => step.status === 'NEEDS_REVIEW');
    return {
      id: publication.id,
      draftId: publication.draftId,
      draftVersion: publication.draftVersion,
      status: publication.status,
      executionMode: publication.executionMode,
      externalWritePerformed:
        publication.executionMode === 'real' &&
        Boolean(publication.confluenceContentId),
      confluencePage: publication.confluenceContentId
        ? {
            id: publication.confluenceContentId,
            version: publication.confluencePageVersion,
            url: publication.confluencePageUrl,
            contentHash: publication.confluenceContentHash,
          }
        : null,
      canRetry: publication.status !== 'PUBLISHED',
      requiresReview,
      steps: steps.map((step) => ({
        key: step.stepKey,
        phase: step.phase,
        status: step.status,
        attempts: step.attempts,
        errorCode: step.errorCode,
        retryable: step.status === 'FAILED',
      })),
      updatedAt: publication.updatedAt,
    };
  }
}
