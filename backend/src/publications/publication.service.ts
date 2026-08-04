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
      return this.present(existingByKey);
    }
    const existingForVersion = await this.publicationsRepository.findOneBy({
      draftId: draft.id,
      draftVersion: draft.optimisticVersion,
    });
    if (existingForVersion) {
      return this.present(existingForVersion);
    }

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
      return this.present(concurrent);
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
    this.assertPublicationDraftVersion(publication, draft);
    this.assertConfluenceSucceeded(await this.stepsFor(publication.id));
    return this.previewService.jira(draft, publication);
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
    this.assertDraftVersion(draft, input.draftVersion);
    const publication = await this.findPublication(draft, publicationId);
    this.assertPublicationDraftVersion(publication, draft);
    const steps = await this.stepsFor(publication.id);
    this.assertConfluenceSucceeded(steps);
    await this.assertReadyForPublication(userId, draft, correlationId);
    const profile = await this.findActivePublishProfile(draft);
    this.assertSafeDraftContent(draft.maskedBrief);
    const preview = this.previewService.jira(draft, publication);
    this.assertPreview(input.previewHash, preview.previewHash);
    const idempotencyKeyHash = this.idempotencyKeyHash(
      userId,
      this.idempotencyKey(input.idempotencyKey),
    );
    this.assertPhaseIdempotencyKey(
      publication.jiraIdempotencyKeyHash,
      idempotencyKeyHash,
      'jira',
    );
    if (
      publication.jiraIdempotencyKeyHash === idempotencyKeyHash &&
      this.phaseSucceeded(steps, 'jira')
    ) {
      return this.present(publication, steps);
    }
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
    this.assertPublicationDraftVersion(publication, draft);
    this.assertJiraSucceeded(await this.stepsFor(publication.id));
    // This readiness pass checks Jira createmeta before the user sees the
    // irreversible child-task approval screen. It runs again immediately
    // before execution so a changed provider configuration cannot bypass it.
    await this.assertReadyForPublication(userId, draft, correlationId);
    return this.previewService.childTasks(draft, publication);
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
    this.assertDraftVersion(draft, input.draftVersion);
    const publication = await this.findPublication(draft, publicationId);
    this.assertPublicationDraftVersion(publication, draft);
    const steps = await this.stepsFor(publication.id);
    this.assertJiraSucceeded(steps);
    await this.assertReadyForPublication(userId, draft, correlationId);
    const profile = await this.findActivePublishProfile(draft);
    this.assertSafeDraftContent(draft.maskedBrief);
    const preview = this.previewService.childTasks(draft, publication);
    this.assertPreview(input.previewHash, preview.previewHash);
    const idempotencyKeyHash = this.idempotencyKeyHash(
      userId,
      this.idempotencyKey(input.idempotencyKey),
    );
    this.assertPhaseIdempotencyKey(
      publication.childTasksIdempotencyKeyHash,
      idempotencyKeyHash,
      'child_tasks',
    );
    if (
      publication.childTasksIdempotencyKeyHash === idempotencyKeyHash &&
      this.phaseSucceeded(steps, 'child_tasks')
    ) {
      return this.present(publication, steps);
    }
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

  private async retryConfluence(
    userId: number,
    draftId: string,
    publicationId: string,
    input: PhaseInput,
    correlationId: string,
  ): Promise<BriefPublicationView> {
    this.assertApproval(input.approved);
    const draft = await this.findOwnedDraft(userId, draftId);
    this.assertDraftVersion(draft, input.draftVersion);
    const publication = await this.findPublication(draft, publicationId);
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
    const idempotencyKeyHash = this.idempotencyKeyHash(
      userId,
      this.idempotencyKey(input.idempotencyKey),
    );
    if (publication.idempotencyKeyHash !== idempotencyKeyHash) {
      throw new ConflictException({ code: 'PUBLICATION_PHASE_KEY_REUSED' });
    }
    const steps = await this.ensureSteps(
      publication,
      'confluence',
      await this.stepsFor(publication.id),
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
    const result = await this.executeStep(step, () =>
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
    if (result) {
      publication.confluenceContentId = result.providerObjectId;
      publication.confluencePageVersion = result.providerObjectVersion ?? null;
      publication.confluencePageUrl = result.providerUrl ?? null;
      publication.confluenceContentHash =
        result.contentHash ?? preview.contentHash;
      publication.updatedAt = new Date();
      publication = await this.publicationsRepository.save(publication);
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
    const linkResult = await this.executeStep(remoteLink, () =>
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
    if (!linkResult) {
      return this.finalize(publication, steps, 'jira', draft);
    }
    publication.jiraRemoteLinkId = linkResult.providerObjectId;
    publication.updatedAt = new Date();
    publication = await this.publicationsRepository.save(publication);

    const comment = this.requiredStep(steps, SUMMARY_COMMENT_STEP);
    const commentResult = await this.executeStep(comment, () =>
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
    if (commentResult) {
      publication.jiraSummaryCommentId = commentResult.providerObjectId;
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
      await this.executeStep(step, () =>
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
    }
    return this.finalize(publication, steps, 'child_tasks', draft);
  }

  private async executeStep(
    step: PublicationStep,
    operation: () => Promise<PublicationWriteResult>,
  ): Promise<PublicationWriteResult | null> {
    if (step.status === 'SUCCEEDED' && step.providerObjectId) {
      return { providerObjectId: step.providerObjectId };
    }
    step.status = 'RUNNING';
    step.errorCode = null;
    step.attempts += 1;
    step.updatedAt = new Date();
    await this.stepsRepository.save(step);
    try {
      const result = await operation();
      if (!this.isWriteResult(result)) {
        throw new PublicationGatewayError(
          this.failureFor(step.stepKey, null).code,
          true,
        );
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
      return result;
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
    phase: PublicationPhase,
    draft: WorkBriefDraft,
  ): Promise<BriefPublicationView> {
    publication.status = this.statusFor(steps, phase, draft);
    publication.updatedAt = new Date();
    const saved = await this.publicationsRepository.save(publication);
    return this.present(saved, steps);
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

  private assertPhaseIdempotencyKey(
    existingHash: string | null,
    requestedHash: string,
    phase: Exclude<PublicationPhase, 'confluence'>,
  ): void {
    if (existingHash && existingHash !== requestedHash) {
      throw new ConflictException({
        code: 'PUBLICATION_PHASE_KEY_REUSED',
        phase,
      });
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
