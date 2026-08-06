import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
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
import {
  PUBLICATION_STEP_HEARTBEAT_INTERVAL_MS,
  PublicationStepClaimerService,
  type StepClaim,
} from './publication-step-claimer.service';
import {
  PublicationGatewayError,
  PUBLICATION_WRITE_GATEWAY,
  type PublicationWriteGateway,
  type PublicationWriteResult,
  type ReconciliationResult,
  type ChildTaskReconciliationEntry,
} from './publication-write-gateway';
import {
  type ChildTasksPublicationPreview,
  type ConfluencePublicationPreview,
  type JiraPublicationPreview,
  PublicationPreviewService,
} from './publication-preview.service';
import type {
  BriefPublicationView,
  DraftDeletionAssessment,
  PublicationErrorCode,
  PublicationPhase,
  PublicationStatus,
  StoredPublicationSummary,
} from './publication.types';

const CONFLUENCE_STEP = 'confluence_page';
const REMOTE_LINK_STEP = 'jira_remote_link';
const SUMMARY_COMMENT_STEP = 'jira_summary_comment';
const CHILD_TASK_STEP_PREFIX = 'jira_child_task:';
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

/**
 * The single definition of "something exists in Atlassian because of this
 * publication".  Draft deletion and the list badge both depend on it, so it
 * must not be restated anywhere else.
 */
const externalWritePerformed = (
  publication: Pick<BriefPublication, 'executionMode' | 'confluenceContentId'>,
): boolean =>
  publication.executionMode === 'real' &&
  Boolean(publication.confluenceContentId);

type PhaseInput = {
  draftVersion: number;
  previewHash: string;
  approved: boolean;
  approvalRevision?: number;
  idempotencyKey: string | undefined;
};

type RetryInput = PhaseInput & { phase: PublicationPhase };

type InitialPublication = {
  publication: BriefPublication;
  steps: PublicationStep[];
};

type StepExecution =
  | { outcome: 'succeeded'; result: PublicationWriteResult }
  | { outcome: 'failed' }
  | { outcome: 'in_progress' }
  | { outcome: 'stale' };

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
    @InjectDataSource() private readonly dataSource: DataSource,
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
    const publication = await this.latestPublicationForDraft(draft.id);
    const sameVersionPublication =
      publication?.draftVersion === draft.optimisticVersion
        ? publication
        : null;
    const approvalRevision = sameVersionPublication
      ? await this.advanceApprovalRevision(sameVersionPublication, 'confluence')
      : 1;
    const preview = await this.previewService.confluence(
      userId,
      draft,
      profile,
      correlationId,
    );
    return { ...preview, approvalRevision };
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
      if (this.isEmptyPendingConfluencePublication(recovered)) {
        return this.resumeEmptyConfluencePublication(
          userId,
          draft,
          recovered.publication,
          input,
          correlationId,
        );
      }
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
      if (this.isEmptyPendingConfluencePublication(recovered)) {
        return this.resumeEmptyConfluencePublication(
          userId,
          draft,
          recovered.publication,
          input,
          correlationId,
        );
      }
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
    const approvalRevision = input.approvalRevision ?? 1;
    if (approvalRevision !== 1) {
      throw new ConflictException({ code: 'PUBLICATION_PREVIEW_STALE' });
    }

    const now = new Date();
    const publication = this.publicationsRepository.create({
      draftId: draft.id,
      operationId: randomUUID(),
      idempotencyKeyHash,
      draftVersion: draft.optimisticVersion,
      status: 'PENDING',
      approvalRevision,
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
    // Only the aggregate insert may lose the unique-index race. Keeping
    // runConfluence outside the catch stops a duplicate-key error raised after
    // an external write from being reported as a concurrent publication.
    let transaction: InitialPublication;
    try {
      transaction = await this.createInitialPublication(
        publication,
        approvalRevision,
      );
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
    return this.runConfluence(
      transaction.publication,
      draft,
      profile,
      transaction.steps,
      userId,
      correlationId,
      { ...preview, approvalRevision },
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
    const approvalRevision = await this.advanceApprovalRevision(
      recovered.publication,
      'jira',
    );
    return {
      ...this.previewService.jira(draft, recovered.publication),
      approvalRevision,
    };
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
    const approvalRevision = this.approvalRevisionForInput(
      input,
      publication,
    );
    const needsReview = this.phaseNeedsReview(steps, 'jira');
    if (needsReview && input.approvalRevision === undefined) {
      throw new ConflictException({
        code: 'PUBLICATION_REVIEW_APPROVAL_REQUIRED',
      });
    }
    const reviewReopened = await this.reopenReviewStepsIfRequired(
      publication,
      steps,
      'jira',
      approvalRevision,
    );
    if (needsReview && !reviewReopened) {
      return this.presentLatestPublication(publication.id);
    }
    publication.approvalRevision = approvalRevision;
    publication.jiraIdempotencyKeyHash = idempotencyKeyHash;
    publication.jiraPreviewHash = preview.previewHash;
    publication.jiraApprovedByUserId = userId;
    publication.jiraApprovedAt = new Date();
    publication.updatedAt = new Date();
    const saved = await this.savePhaseApproval(publication, 'jira');
    const phaseSteps = await this.ensureSteps(
      saved,
      'jira',
      steps,
      [],
      null,
      approvalRevision,
    );
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
    const approvalRevision = await this.advanceApprovalRevision(
      recovered.publication,
      'child_tasks',
    );
    return {
      ...this.previewService.childTasks(
        draft,
        recovered.publication,
        profile,
      ),
      approvalRevision,
    };
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
    const approvalRevision = this.approvalRevisionForInput(
      input,
      publication,
    );
    const needsReview = this.phaseNeedsReview(steps, 'child_tasks');
    if (needsReview && input.approvalRevision === undefined) {
      throw new ConflictException({
        code: 'PUBLICATION_REVIEW_APPROVAL_REQUIRED',
      });
    }
    const reviewReopened = await this.reopenReviewStepsIfRequired(
      publication,
      steps,
      'child_tasks',
      approvalRevision,
    );
    if (needsReview && !reviewReopened) {
      return this.presentLatestPublication(publication.id);
    }
    publication.approvalRevision = approvalRevision;
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
      approvalRevision,
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

  /**
   * Latest stored publication per draft, in one query.
   *
   * Callers must have already scoped `draftIds` to the requesting user — this
   * method performs no ownership check because it exists to serve a list that
   * was itself filtered by `createdByUserId`.
   *
   * Unlike `findLatest` this never runs step recovery, so it issues no
   * Atlassian calls no matter how many drafts are on the page (R4).
   */
  async findLatestStoredSummaries(
    draftIds: string[],
  ): Promise<Map<string, StoredPublicationSummary>> {
    if (draftIds.length === 0) {
      return new Map();
    }

    const rows = await this.publicationsRepository.query<
      Array<
        Pick<
          BriefPublication,
          'id' | 'draftId' | 'status' | 'executionMode' | 'confluenceContentId'
        >
      >
    >(
      `SELECT DISTINCT ON ("draftId")
              "draftId", "id", "status", "executionMode", "confluenceContentId"
         FROM "brief_publications"
        WHERE "draftId" = ANY($1::uuid[])
        ORDER BY "draftId", "createdAt" DESC`,
      [draftIds],
    );

    return new Map(
      rows.map((row) => [
        row.draftId,
        {
          draftId: row.draftId,
          id: row.id,
          status: row.status,
          externalWritePerformed: externalWritePerformed(row),
        },
      ]),
    );
  }

  /**
   * Deletion guard for a single draft, from stored rows only.
   *
   * Every publication of the draft is scanned rather than just the latest one.
   * A draft that once wrote to Confluence must stay undeletable even if a
   * later mock publication sits on top of it, otherwise deleting it would let
   * a fresh draft for the same issue create a duplicate page (R6).  This is
   * also the invariant the 90-day retention job relies on when it refuses to
   * hard-delete drafts with external writes.
   */
  async assessDraftDeletion(draftId: string): Promise<DraftDeletionAssessment> {
    const publications = await this.publicationsRepository.find({
      select: {
        id: true,
        status: true,
        executionMode: true,
        confluenceContentId: true,
      },
      where: { draftId },
    });

    return {
      publishing: publications.some(
        (publication) => publication.status === 'PUBLISHING',
      ),
      externalWritePerformed: publications.some(externalWritePerformed),
    };
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
    const approvalRevision = this.approvalRevisionForInput(
      input,
      publication,
    );
    const needsReview = this.phaseNeedsReview(
      existingSteps,
      'confluence',
    );
    if (needsReview && input.approvalRevision === undefined) {
      throw new ConflictException({
        code: 'PUBLICATION_REVIEW_APPROVAL_REQUIRED',
      });
    }
    const reviewReopened = await this.reopenReviewStepsIfRequired(
      publication,
      existingSteps,
      'confluence',
      approvalRevision,
    );
    if (needsReview && !reviewReopened) {
      return this.presentLatestPublication(publication.id);
    }
    publication.approvalRevision = approvalRevision;
    const steps = await this.ensureSteps(
      publication,
      'confluence',
      existingSteps,
      [],
      null,
      approvalRevision,
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
    const execution = await this.executeStep(
      step,
      () =>
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
      preview.contentHash,
    );
    if (execution.outcome === 'in_progress') {
      return this.present(publication);
    }
    if (execution.outcome === 'stale') {
      return this.presentLatestPublication(publication.id);
    }
    if (execution.outcome === 'succeeded') {
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
    if (linkExecution.outcome === 'stale') {
      return this.presentLatestPublication(publication.id);
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
    if (commentExecution.outcome === 'stale') {
      return this.presentLatestPublication(publication.id);
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
    const selectedTasks = this.selectedChildTasks(draft);
    let reconciliation: ReconciliationResult<
      Map<string, ChildTaskReconciliationEntry>
    >;
    try {
      reconciliation = await this.writeGateway.reconcileJiraChildTasks({
        userId,
        correlationId,
        profile,
        operationId: publication.operationId,
        sourceJiraKey: draft.sourceJiraKey,
        clientTaskIds: selectedTasks.map((task) => task.clientTaskId),
      });
    } catch {
      reconciliation = {
        status: 'indeterminate',
        reason: 'provider_unavailable',
      };
    }
    if (reconciliation.status === 'indeterminate') {
      const step = steps.find(
        (candidate) =>
          candidate.phase === 'child_tasks' && candidate.status !== 'SUCCEEDED',
      );
      if (step) {
        const execution = await this.executeStep(step, () =>
          Promise.reject(
            new PublicationGatewayError(
              'PUBLICATION_RECONCILIATION_INDETERMINATE',
              true,
            ),
          ),
        );
        if (execution.outcome === 'stale') {
          return this.presentLatestPublication(publication.id);
        }
      }
      return this.finalize(publication, steps, 'child_tasks', draft);
    }
    const existingTasks =
      reconciliation.status === 'found'
        ? reconciliation.value
        : new Map<string, ChildTaskReconciliationEntry>();
    for (const childTask of selectedTasks) {
      const step = this.requiredStep(steps, this.childTaskStepKey(childTask));
      const existing = existingTasks.get(childTask.clientTaskId);
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
          reconciledProviderObjectId: existing?.issueId,
          reconciliationCompleted: true,
        }),
      );
      if (execution.outcome === 'in_progress') {
        return this.present(publication);
      }
      if (execution.outcome === 'stale') {
        return this.presentLatestPublication(publication.id);
      }
      if (execution.outcome === 'succeeded') {
        existingTasks.set(childTask.clientTaskId, {
          issueId: execution.result.providerObjectId,
          operationId: publication.operationId,
        });
      }
    }
    return this.finalize(publication, steps, 'child_tasks', draft);
  }

  private async executeStep(
    step: PublicationStep,
    operation: () => Promise<PublicationWriteResult>,
    fallbackContentHash?: string,
  ): Promise<StepExecution> {
    const existing = this.writeResultFromStep(step);
    if (existing) {
      return { outcome: 'succeeded', result: existing };
    }
    const claim: StepClaim = await this.stepClaimer.claim(step.id);
    if (!claim.claimed) {
      return { outcome: 'in_progress' };
    }

    step.status = 'RUNNING';
    step.errorCode = null;
    step.attempts += 1;
    step.executionToken = claim.executionToken;
    step.executionLeaseExpiresAt = claim.leaseExpiresAt;
    step.updatedAt = new Date();

    if (claim.reclaimedInterrupted) {
      return this.parkInterruptedExecution(step, claim.executionToken);
    }

    let heartbeatLost = false;
    const heartbeatTimer = setInterval(() => {
      void this.stepClaimer
        .heartbeat(step.id, claim.executionToken)
        .then((alive) => {
          if (!alive) {
            heartbeatLost = true;
          }
        })
        .catch(() => {
          heartbeatLost = true;
        });
    }, PUBLICATION_STEP_HEARTBEAT_INTERVAL_MS);

    let result: PublicationWriteResult;
    try {
      result = await operation();
      if (!this.isWriteResult(result)) {
        throw new PublicationGatewayError(
          this.failureFor(step.stepKey, null).code,
          true,
        );
      }
      result = {
        ...result,
        ...(result.contentHash || !fallbackContentHash
          ? {}
          : { contentHash: fallbackContentHash }),
      };
    } catch (error) {
      clearInterval(heartbeatTimer);
      const failure = this.failureFor(step.stepKey, error);
      const status = failure.retryable ? 'FAILED' : 'NEEDS_REVIEW';
      const fenced = await this.stepClaimer.markFailed(
        step.id,
        claim.executionToken,
        status,
        failure.code,
      );
      if (!fenced || heartbeatLost) {
        return { outcome: 'stale' };
      }
      step.status = status;
      step.errorCode = failure.code;
      step.executionToken = null;
      step.executionLeaseExpiresAt = null;
      step.updatedAt = new Date();
      this.metrics?.increment('publication_stage_total', {
        stage: this.metricStage(step.stepKey),
        outcome: 'failure',
      });
      return { outcome: 'failed' };
    }

    clearInterval(heartbeatTimer);
    const fenced = await this.stepClaimer.markSucceeded(
      step.id,
      claim.executionToken,
      result,
    );
    if (!fenced || heartbeatLost) {
      return { outcome: 'stale' };
    }
    step.status = 'SUCCEEDED';
    step.providerObjectId = result.providerObjectId;
    step.providerObjectVersion = result.providerObjectVersion ?? null;
    step.providerUrl = result.providerUrl ?? null;
    step.contentHash = result.contentHash ?? null;
    step.errorCode = null;
    step.executionToken = null;
    step.executionLeaseExpiresAt = null;
    step.updatedAt = new Date();
    this.metrics?.increment('publication_stage_total', {
      stage: this.metricStage(step.stepKey),
      outcome: 'success',
    });
    return { outcome: 'succeeded', result };
  }

  /**
   * A previous worker was killed while the provider write may already have
   * been dispatched, and nothing durable records how it ended. Re-issuing the
   * create here would rely on provider search to prove absence, which is not
   * read-your-write consistent (Jira child tasks are found through a JQL
   * index), so a fresh create can duplicate an object that already exists.
   * Park the step for the revision-gated review flow instead.
   */
  private async parkInterruptedExecution(
    step: PublicationStep,
    executionToken: string,
  ): Promise<StepExecution> {
    const errorCode: PublicationErrorCode =
      'PUBLICATION_RECONCILIATION_INDETERMINATE';
    const fenced = await this.stepClaimer.markFailed(
      step.id,
      executionToken,
      'NEEDS_REVIEW',
      errorCode,
    );
    if (!fenced) {
      return { outcome: 'stale' };
    }
    step.status = 'NEEDS_REVIEW';
    step.errorCode = errorCode;
    step.executionToken = null;
    step.executionLeaseExpiresAt = null;
    step.updatedAt = new Date();
    this.metrics?.increment('publication_stage_total', {
      stage: this.metricStage(step.stepKey),
      outcome: 'failure',
    });
    return { outcome: 'failed' };
  }

  private async finalize(
    publication: BriefPublication,
    steps: PublicationStep[],
    phase: PublicationPhase,
    draft: WorkBriefDraft,
  ): Promise<BriefPublicationView> {
    const currentSteps = await this.stepsFor(publication.id);
    publication.status = this.statusFor(currentSteps, phase, draft);
    if (
      publication.status !== 'NEEDS_REVIEW' &&
      !currentSteps.some((step) => step.status === 'NEEDS_REVIEW')
    ) {
      publication.reviewRequiredAt = null;
    }
    publication.updatedAt = new Date();
    const saved = await this.publicationsRepository.save(publication);
    return this.present(saved, currentSteps);
  }

  private async createInitialPublication(
    publication: BriefPublication,
    approvalRevision: number,
  ): Promise<InitialPublication> {
    const createStep = (repository: Repository<PublicationStep>) =>
      repository.create({
        publicationId: publication.id,
        stepKey: CONFLUENCE_STEP,
        phase: 'confluence',
        status: 'PENDING',
        attempts: 0,
        errorCode: null,
        providerObjectId: null,
        providerObjectVersion: null,
        providerUrl: null,
        contentHash: null,
        executionToken: null,
        executionLeaseExpiresAt: null,
        reviewRevision: approvalRevision,
        approvedRevision: approvalRevision,
        idempotencyKeyHash: null,
      });

    return this.dataSource.transaction(async (manager: EntityManager) => {
      const publications = manager.getRepository(BriefPublication);
      const steps = manager.getRepository(PublicationStep);
      const stored = await publications.save(publication);
      await steps.insert(createStep(steps));
      return {
        publication: stored,
        steps: await steps.find({
          where: { publicationId: stored.id },
          order: { createdAt: 'ASC' },
        }),
      };
    });
  }

  private isEmptyPendingConfluencePublication(
    recovered: { publication: BriefPublication; steps: PublicationStep[] },
  ): boolean {
    return (
      recovered.publication.status === 'PENDING' &&
      recovered.steps.length === 0
    );
  }

  private async resumeEmptyConfluencePublication(
    userId: number,
    draft: WorkBriefDraft,
    publication: BriefPublication,
    input: PhaseInput,
    correlationId: string,
  ): Promise<BriefPublicationView> {
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
    const approvalRevision = this.approvalRevisionForInput(input, publication);
    publication.approvalRevision = approvalRevision;
    publication.confluencePreviewHash = preview.previewHash;
    publication.approvedByUserId = userId;
    publication.approvedAt = new Date();
    publication.updatedAt = new Date();
    const saved = await this.publicationsRepository.save(publication);
    const steps = await this.ensureSteps(
      saved,
      'confluence',
      [],
      [],
      null,
      approvalRevision,
    );
    return this.runConfluence(
      saved,
      draft,
      profile,
      steps,
      userId,
      correlationId,
      { ...preview, approvalRevision },
    );
  }

  private async latestPublicationForDraft(
    draftId: string,
  ): Promise<BriefPublication | null> {
    const publications = await this.publicationsRepository.find({
      where: { draftId },
      order: { createdAt: 'DESC' },
    });
    return publications.at(0) ?? null;
  }

  private async advanceApprovalRevision(
    publication: BriefPublication,
    phase: PublicationPhase,
  ): Promise<number> {
    const currentRevision = Math.max(publication.approvalRevision ?? 0, 0);
    // Increment and read in one statement. A separate read-back can observe a
    // concurrent preview's value and hand two callers the same revision.
    const allocated = await this.publicationsRepository
      .createQueryBuilder()
      .update(BriefPublication)
      .set({ approvalRevision: () => '"approvalRevision" + 1' })
      .where('"id" = :id', { id: publication.id })
      .returning(['approvalRevision'])
      .execute();
    const revision = Math.max(
      this.revisionValue(allocated.raw) ?? 0,
      currentRevision + 1,
    );
    publication.approvalRevision = revision;
    const phaseSteps = await this.stepsFor(publication.id);
    for (const step of phaseSteps.filter((candidate) => candidate.phase === phase)) {
      await this.stepsRepository.update(
        { id: step.id },
        { reviewRevision: revision },
      );
      step.reviewRevision = revision;
    }
    return revision;
  }

  private revisionValue(raw: unknown): number | null {
    const row = Array.isArray(raw) ? (raw as unknown[]).at(0) : null;
    const value =
      typeof row === 'object' && row !== null
        ? (row as { approvalRevision?: unknown }).approvalRevision
        : null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    // Postgres returns integer columns as strings through some drivers.
    const parsed = typeof value === 'string' ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
  }

  private approvalRevisionForInput(
    input: PhaseInput,
    publication: BriefPublication,
  ): number {
    const currentRevision = Math.max(publication.approvalRevision ?? 1, 1);
    if (
      input.approvalRevision !== undefined &&
      input.approvalRevision !== currentRevision
    ) {
      throw new ConflictException({
        code: 'PUBLICATION_PREVIEW_STALE',
      });
    }
    return input.approvalRevision ?? currentRevision;
  }

  private phaseNeedsReview(
    steps: readonly PublicationStep[],
    phase: PublicationPhase,
  ): boolean {
    return steps.some(
      (step) => step.phase === phase && step.status === 'NEEDS_REVIEW',
    );
  }

  private async reopenReviewStepsIfRequired(
    publication: BriefPublication,
    steps: PublicationStep[],
    phase: PublicationPhase,
    approvalRevision: number,
  ): Promise<boolean> {
    const candidates = steps.filter(
      (step) => step.phase === phase && step.status === 'NEEDS_REVIEW',
    );
    if (candidates.length === 0) {
      return true;
    }
    if (
      publication.approvalRevision !== approvalRevision ||
      candidates.some((step) => step.reviewRevision !== approvalRevision)
    ) {
      throw new ConflictException({
        code: 'PUBLICATION_REVIEW_APPROVAL_REQUIRED',
      });
    }

    let reopened = false;
    for (const step of candidates) {
      const changed = await this.stepClaimer.reopenForReview(
        step.id,
        approvalRevision,
      );
      if (!changed) {
        continue;
      }
      reopened = true;
      step.status = 'PENDING';
      step.errorCode = null;
      step.approvedRevision = approvalRevision;
      step.executionToken = null;
      step.executionLeaseExpiresAt = null;
      step.updatedAt = new Date();
    }
    return reopened;
  }

  private async presentLatestPublication(
    publicationId: string,
  ): Promise<BriefPublicationView> {
    const publication = await this.publicationsRepository.findOneBy({
      id: publicationId,
    });
    if (!publication) {
      throw new NotFoundException('Brief publication was not found.');
    }
    const steps = await this.stepsFor(publication.id);
    const recovered = await this.recoverPublicationFromSteps(
      publication,
      await this.draftForPublication(publication),
      steps,
    );
    return this.present(recovered.publication, recovered.steps);
  }

  private async draftForPublication(
    publication: BriefPublication,
  ): Promise<WorkBriefDraft> {
    const draft = await this.draftsRepository.findOneBy({ id: publication.draftId });
    if (!draft) {
      throw new NotFoundException('Brief draft was not found.');
    }
    return draft;
  }

  private statusFor(
    steps: readonly PublicationStep[],
    phase: PublicationPhase,
    draft: WorkBriefDraft,
  ): PublicationStatus {
    const phaseSteps = steps.filter((step) => step.phase === phase);
    if (phaseSteps.length === 0) {
      const laterPhaseExists =
        phase === 'confluence'
          ? steps.some((step) => step.phase !== 'confluence')
          : phase === 'jira'
            ? steps.some((step) => step.phase === 'child_tasks')
            : false;
      return laterPhaseExists ? 'NEEDS_REVIEW' : 'PENDING';
    }
    if (
      (phase === 'jira' && !this.phaseSucceeded(steps, 'confluence')) ||
      (phase === 'child_tasks' &&
        (!this.phaseSucceeded(steps, 'confluence') ||
          !this.phaseSucceeded(steps, 'jira')))
    ) {
      return 'NEEDS_REVIEW';
    }
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
    approvalRevision?: number,
  ): Promise<PublicationStep[]> {
    const existing = loadedSteps ?? (await this.stepsFor(publication.id));
    const keys = this.stepKeys(phase, childTasks);
    const existingKeys = new Set(existing.map((step) => step.stepKey));
    const missing = keys.filter((key) => !existingKeys.has(key));
    if (missing.length === 0) {
      return existing;
    }
    const revision = approvalRevision ?? publication.approvalRevision ?? 1;
    const values = missing.map((stepKey) =>
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
        executionToken: null,
        executionLeaseExpiresAt: null,
        reviewRevision: revision,
        approvedRevision: revision,
        idempotencyKeyHash:
          phase === 'child_tasks' && childTaskIdempotencyKeyHash
            ? this.childTaskIdempotencyHash(
                childTaskIdempotencyKeyHash,
                stepKey,
              )
            : null,
      }),
    );
    await this.stepsRepository
      .createQueryBuilder()
      .insert()
      .into(PublicationStep)
      .values(values)
      .orIgnore()
      .execute();
    return this.stepsFor(publication.id);
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
    const invalidPhaseOrder = this.hasInvalidPhaseOrder(steps);
    const recoveredStatus = invalidPhaseOrder
      ? 'NEEDS_REVIEW'
      : this.statusFor(steps, phase, draft);
    if (publication.status !== recoveredStatus) {
      publication.status = recoveredStatus;
      changed = true;
    }
    if (invalidPhaseOrder && !publication.reviewRequiredAt) {
      publication.reviewRequiredAt = new Date();
      changed = true;
    }
    if (
      !invalidPhaseOrder &&
      recoveredStatus !== 'NEEDS_REVIEW' &&
      !steps.some((step) => step.status === 'NEEDS_REVIEW') &&
      publication.reviewRequiredAt
    ) {
      publication.reviewRequiredAt = null;
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

  private hasInvalidPhaseOrder(steps: readonly PublicationStep[]): boolean {
    const hasJira = steps.some((step) => step.phase === 'jira');
    const hasChildTasks = steps.some((step) => step.phase === 'child_tasks');
    return (
      (hasJira && !this.phaseSucceeded(steps, 'confluence')) ||
      (hasChildTasks &&
        (!this.phaseSucceeded(steps, 'confluence') ||
          !this.phaseSucceeded(steps, 'jira')))
    );
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
      publication.status === 'NEEDS_REVIEW' ||
      steps.some((step) => step.status === 'NEEDS_REVIEW');
    return {
      id: publication.id,
      draftId: publication.draftId,
      draftVersion: publication.draftVersion,
      status: publication.status,
      executionMode: publication.executionMode,
      externalWritePerformed: externalWritePerformed(publication),
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
