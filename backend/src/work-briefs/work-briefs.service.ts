import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import type { NormalizedEvidence } from '../work-items/evidence/evidence-normalizer';
import {
  ConfluenceWorkItemService,
  type ConfluenceDraftContext,
} from '../work-items/confluence/confluence-work-item.service';
import type { JiraDraftContext } from '../work-items/jira/jira-work-item.service';
import { JiraWorkItemService } from '../work-items/jira/jira-work-item.service';
import { SafeAuditService } from '../operations/safe-audit.service';
import { PublicationService } from '../publications/publication.service';
import { BriefCitationValidatorService } from './brief-citation-validator.service';
import type {
  BriefContent,
  BriefDraftListView,
  BriefDraftPublicationSummary,
  BriefDraftSummary,
  BriefDraftView,
  DraftBlocker,
  EvidenceCitation,
  StoredBriefEvidence,
} from './brief-draft.types';
import {
  CreateBriefDraftDto,
  DRAFT_LIST_DEFAULT_LIMIT,
  ListBriefDraftsDto,
  RefreshBriefDraftDto,
  RegenerateBriefDraftDto,
  UpdateBriefDraftDto,
} from './dto/brief-draft.dto';
import { TransientEvidenceFragmentsService } from './transient-evidence-fragments.service';
import { lockBriefDraft } from './brief-draft-lock';
import {
  WorkBriefAiClientService,
  type WorkBriefCitation,
  type WorkBriefOutput,
} from './work-brief-ai-client.service';
import { WorkBriefDraft } from './entities/work-brief-draft.entity';

// The draft list shows own drafts only, so a colleague's draft on the same
// issue is invisible and a bare "already exists" reads as a dead end. Say that
// someone else may own it without disclosing who.
const DRAFT_ALREADY_EXISTS_MESSAGE =
  'A brief draft already exists for this issue. It may have been created by another user.';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class WorkBriefsService {
  constructor(
    @InjectRepository(WorkBriefDraft)
    private readonly draftsRepository: Repository<WorkBriefDraft>,
    private readonly jiraWorkItemService: JiraWorkItemService,
    private readonly confluenceWorkItemService: ConfluenceWorkItemService,
    private readonly aiClient: WorkBriefAiClientService,
    private readonly citationValidator: BriefCitationValidatorService,
    private readonly publicationService: PublicationService,
    private readonly fragments: TransientEvidenceFragmentsService,
    private readonly audit: SafeAuditService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async createDraft(
    userId: number,
    dto: CreateBriefDraftDto,
    correlationId: string,
  ): Promise<BriefDraftView> {
    const selectedEvidenceIds = this.selectedEvidenceIds(
      dto.selectedEvidenceIds,
    );
    const context = await this.jiraWorkItemService.collectIssueDraftContext(
      userId,
      dto.sourceJiraKey,
      correlationId,
    );
    const selectedJiraEvidence = this.selectedJiraEvidence(
      context,
      selectedEvidenceIds.jira,
    );
    const confluenceContext =
      selectedEvidenceIds.confluence.length > 0
        ? await this.confluenceWorkItemService.collectDraftEvidence(
            userId,
            selectedEvidenceIds.confluence,
            correlationId,
          )
        : null;
    const selectedConfluenceEvidence = this.selectedConfluenceEvidence(
      context,
      confluenceContext,
      selectedEvidenceIds.confluence,
    );
    const selectedEvidence = [
      ...selectedJiraEvidence,
      ...selectedConfluenceEvidence,
    ];
    await this.assertNoExistingDraft(context.profileId, context.sourceJiraId);
    const output = await this.aiClient.generate(
      dto.instruction,
      selectedEvidence.map((item) => ({
        evidenceId: item.evidence.id,
        content: item.content,
      })),
    );
    const content = this.contentFromAi(output);
    const evidence = this.evidenceFromAi(selectedEvidence, output, content);

    const draft = this.draftsRepository.create({
      profileId: context.profileId as string,
      createdByUserId: userId,
      sourceJiraId: context.sourceJiraId as string,
      sourceJiraKey: context.sourceJiraKey,
      sourceJiraVersion: context.sourceJiraVersion as string,
      maskedBrief: content,
      evidence,
      status: 'draft',
      freshnessStatus: 'current',
      optimisticVersion: 1,
      policyVersion: 1,
    });
    let stored: WorkBriefDraft;
    try {
      stored = await this.draftsRepository.save(draft);
    } catch (error) {
      if (this.isDuplicateDraftError(error)) {
        this.draftAlreadyExists();
      }
      throw error;
    }

    return this.present(stored);
  }

  async findDraft(userId: number, draftId: string): Promise<BriefDraftView> {
    return this.present(await this.findOwnedDraft(userId, draftId));
  }

  /**
   * Own drafts only (`createdByUserId = userId`), same strength as
   * `findOwnedDraft`.  No new permission model is introduced here; a
   * colleague's draft on the same issue stays invisible and only surfaces as
   * the create-time 409.
   */
  async listDrafts(
    userId: number,
    query: ListBriefDraftsDto,
  ): Promise<BriefDraftListView> {
    const limit = query.limit ?? DRAFT_LIST_DEFAULT_LIMIT;
    const cursor = this.decodeCursor(query.cursor);
    const builder = this.draftsRepository
      .createQueryBuilder('draft')
      .where('draft."createdByUserId" = :userId', { userId })
      // Redundant with the entity's soft delete filter, and kept anyway: the
      // list is the one place where a leaked deleted row is user-visible.
      .andWhere('draft."deletedAt" IS NULL')
      .orderBy('draft."updatedAt"', 'DESC')
      .addOrderBy('draft."id"', 'DESC')
      // One extra row decides whether a next page exists without a COUNT.
      .take(limit + 1);

    if (query.status) {
      builder.andWhere('draft."status" = :status', { status: query.status });
    }
    if (cursor) {
      // Row-value comparison matches the (createdByUserId, updatedAt DESC,
      // id DESC) partial index, and the id tiebreaker keeps paging stable
      // when two drafts share an updatedAt (R12).
      builder.andWhere(
        '(draft."updatedAt", draft."id") < (:cursorUpdatedAt, :cursorId)',
        { cursorUpdatedAt: cursor.updatedAt, cursorId: cursor.id },
      );
    }

    const rows = await builder.getMany();
    const items = rows.slice(0, limit);
    // Stored publication rows only — no step recovery, so no Atlassian call
    // is made per draft (R4).
    const publications =
      await this.publicationService.findLatestStoredSummaries(
        items.map((draft) => draft.id),
      );

    return {
      items: items.map((draft) => {
        const publication = publications.get(draft.id);

        return this.presentSummary(
          draft,
          publication
            ? {
                id: publication.id,
                status: publication.status,
                externalWritePerformed: publication.externalWritePerformed,
              }
            : null,
        );
      }),
      nextCursor:
        rows.length > limit ? this.encodeCursor(items[items.length - 1]) : null,
    };
  }

  /**
   * Soft-delete a draft so its Jira issue is released for a new one.
   *
   * No `optimisticVersion` is required: deletion is not a lost update, and a
   * concurrently editing tab learns about it from the 404 on its next save.
   */
  async deleteDraft(
    userId: number,
    draftId: string,
    correlationId: string,
  ): Promise<void> {
    const draft = await this.dataSource.transaction(async (manager) => {
      await lockBriefDraft(manager, draftId);
      const drafts = manager.getRepository(WorkBriefDraft);
      // Not owned or already deleted both land here as 404, so the response
      // cannot be used to probe whether a draft id exists.
      const liveDraft = await drafts.findOneBy({
        id: draftId,
        createdByUserId: userId,
      });
      if (!liveDraft) {
        throw new NotFoundException('Brief draft was not found.');
      }
      const publication = await this.publicationService.assessDraftDeletion(
        draftId,
        manager,
      );

      if (publication.publishing) {
        throw new ConflictException({ code: 'PUBLICATION_IN_PROGRESS' });
      }
      if (publication.externalWritePerformed) {
        // Deleting would free the issue for a new draft, and publishing that
        // one would create a second Confluence page for work already
        // published. Resume or retry the existing publication instead (R6).
        throw new ConflictException({ code: 'DRAFT_HAS_PUBLICATION' });
      }

      const deleted = await drafts.update(
        { id: draftId, createdByUserId: userId, deletedAt: IsNull() },
        { deletedAt: new Date() },
      );
      if (deleted.affected !== 1) {
        throw new NotFoundException('Brief draft was not found.');
      }

      // Soft delete does not fire the fragments' ON DELETE CASCADE, so the
      // encrypted excerpts are removed explicitly in this same transaction.
      await this.fragments.purgeDraft(draftId, manager);
      return liveDraft;
    });

    // Draft id, issue key and profile only — never brief content.
    await this.audit.record({
      actorUserId: userId,
      action: 'BRIEF_DRAFT_DELETED',
      profileId: draft.profileId,
      // A bounded composite preserves both identifiers after the draft itself
      // is hard-deleted by the retention job.
      targetId: `draft:${draft.id}:issue:${draft.sourceJiraKey}`,
      correlationId,
      resultCode: 'SOFT_DELETED',
    });
  }

  private encodeCursor(draft: WorkBriefDraft): string {
    return Buffer.from(
      `${draft.updatedAt.toISOString()}|${draft.id}`,
      'utf8',
    ).toString('base64url');
  }

  private decodeCursor(
    cursor: string | undefined,
  ): { updatedAt: Date; id: string } | null {
    if (!cursor) {
      return null;
    }

    const [updatedAt, id, ...rest] = Buffer.from(cursor, 'base64url')
      .toString('utf8')
      .split('|');
    const parsed = new Date(updatedAt ?? '');

    if (
      rest.length > 0 ||
      !id ||
      !UUID_PATTERN.test(id) ||
      Number.isNaN(parsed.getTime())
    ) {
      throw new BadRequestException('Draft list cursor is invalid.');
    }

    return { updatedAt: parsed, id };
  }

  async updateDraft(
    userId: number,
    draftId: string,
    dto: UpdateBriefDraftDto,
  ): Promise<BriefDraftView> {
    const draft = await this.findOwnedDraft(userId, draftId);
    const content = this.citationValidator.validate(
      dto.content,
      new Set(draft.evidence.map((item) => item.id)),
    );
    const maskedContent = await this.maskContent(content);

    const updated = await this.draftsRepository.update(
      {
        id: draftId,
        createdByUserId: userId,
        optimisticVersion: dto.optimisticVersion,
        // `update()` ignores the soft delete filter. Without this a deleted
        // draft would be resurrected by a stale tab's save.
        deletedAt: IsNull(),
      },
      {
        maskedBrief: maskedContent,
        optimisticVersion: dto.optimisticVersion + 1,
        updatedAt: new Date(),
      },
    );
    await this.assertUpdateSucceeded(
      userId,
      draftId,
      dto.optimisticVersion,
      updated.affected,
    );

    return this.present(await this.findOwnedDraft(userId, draftId));
  }

  /**
   * Re-run generation over the draft's sources and replace the brief in place.
   *
   * The evidence excerpts are never stored, so this re-reads every source with
   * the user's own OAuth token exactly like `createDraft` does.  The user's
   * manual edits are overwritten wholesale: the client keeps the pre-
   * regeneration content for a single undo, and a draft version history table
   * stays out of scope.
   */
  async regenerateDraft(
    userId: number,
    draftId: string,
    dto: RegenerateBriefDraftDto,
    correlationId: string,
  ): Promise<BriefDraftView> {
    const draft = await this.findOwnedDraft(userId, draftId);
    if (draft.optimisticVersion !== dto.optimisticVersion) {
      this.versionConflict(draft.optimisticVersion, dto.optimisticVersion);
    }
    if (draft.freshnessStatus !== 'current') {
      // Same rule as saving: a draft whose sources moved has to be refreshed
      // and re-reviewed before it is rewritten.
      throw new ConflictException({
        code:
          draft.freshnessStatus === 'access_changed'
            ? 'ACCESS_CHANGED'
            : 'SOURCE_REVIEW_REQUIRED',
      });
    }

    const selectedEvidenceIds = this.selectedEvidenceIds(
      dto.selectedEvidenceIds ?? draft.evidence.map((item) => item.id),
    );
    const context = await this.jiraWorkItemService.collectIssueDraftContext(
      userId,
      draft.sourceJiraKey,
      correlationId,
    );
    if (context.profileId !== draft.profileId) {
      throw new ConflictException(
        'Selected Jira evidence is no longer accessible.',
      );
    }
    if (context.sourceJiraVersion !== draft.sourceJiraVersion) {
      // The issue moved while the draft looked current. Regenerating now would
      // silently adopt the new version without the review step.
      throw new ConflictException({ code: 'SOURCE_REVIEW_REQUIRED' });
    }

    const selectedJiraEvidence = this.selectedJiraEvidence(
      context,
      selectedEvidenceIds.jira,
    );
    const confluenceContext =
      selectedEvidenceIds.confluence.length > 0
        ? await this.confluenceWorkItemService.collectDraftEvidence(
            userId,
            selectedEvidenceIds.confluence,
            correlationId,
          )
        : null;
    const selectedEvidence = [
      ...selectedJiraEvidence,
      ...this.selectedConfluenceEvidence(
        context,
        confluenceContext,
        selectedEvidenceIds.confluence,
      ),
    ];

    const output = await this.aiClient.generate(
      dto.instruction,
      selectedEvidence.map((item) => ({
        evidenceId: item.evidence.id,
        content: item.content,
      })),
    );
    const content = this.contentFromAi(output);
    const evidence = this.evidenceFromAi(selectedEvidence, output, content);

    const updated = await this.draftsRepository.update(
      {
        id: draftId,
        createdByUserId: userId,
        optimisticVersion: dto.optimisticVersion,
        deletedAt: IsNull(),
      },
      {
        maskedBrief: await this.maskContent(content),
        evidence,
        optimisticVersion: dto.optimisticVersion + 1,
        updatedAt: new Date(),
      },
    );
    // The readiness cache keys on optimisticVersion, so the bump invalidates
    // the previous assessment without touching readiness_assessments here.
    await this.assertUpdateSucceeded(
      userId,
      draftId,
      dto.optimisticVersion,
      updated.affected,
    );

    return this.present(await this.findOwnedDraft(userId, draftId));
  }

  async refreshDraft(
    userId: number,
    draftId: string,
    dto: RefreshBriefDraftDto,
    correlationId: string,
  ): Promise<BriefDraftView> {
    const draft = await this.findOwnedDraft(userId, draftId);
    if (draft.optimisticVersion !== dto.optimisticVersion) {
      this.versionConflict(draft.optimisticVersion);
    }

    const context = await this.jiraWorkItemService.collectIssueDraftContext(
      userId,
      draft.sourceJiraKey,
      correlationId,
    );
    const selectedJiraEvidenceIds = new Set(
      draft.evidence
        .filter((item) => item.provider === 'jira')
        .map((item) => item.id),
    );
    const currentJiraEvidence = context.evidence.filter((item) =>
      selectedJiraEvidenceIds.has(item.evidence.id),
    );
    const selectedConfluenceEvidenceIds = draft.evidence
      .filter((item) => item.provider === 'confluence')
      .map((item) => item.id);
    const confluenceContext =
      selectedConfluenceEvidenceIds.length > 0
        ? await this.confluenceWorkItemService.collectEvidenceMetadata(
            userId,
            selectedConfluenceEvidenceIds,
            correlationId,
          )
        : null;
    const currentConfluenceEvidence = confluenceContext?.evidence ?? [];
    const inaccessible =
      context.accessStatus !== 'accessible' ||
      context.profileId !== draft.profileId ||
      (confluenceContext !== null &&
        (confluenceContext.accessStatus !== 'accessible' ||
          confluenceContext.profileId !== draft.profileId)) ||
      currentJiraEvidence.length + currentConfluenceEvidence.length !==
        draft.evidence.length;

    if (inaccessible) {
      return this.applyRefresh(draft, dto.optimisticVersion, {
        evidence: [],
        freshnessStatus: 'access_changed',
        status: 'review_required',
      });
    }

    const currentEvidenceById = new Map(
      [
        ...currentJiraEvidence.map((item) => item.evidence),
        ...currentConfluenceEvidence,
      ].map((item) => [item.id, item]),
    );
    const refreshedEvidence = draft.evidence.map((stored) => {
      const current = currentEvidenceById.get(stored.id);

      if (!current) {
        return stored;
      }

      return {
        ...current,
        // Metadata-only Confluence refreshes intentionally do not re-read the
        // page body. Retain the prior safe length instead of fabricating one.
        excerptLength:
          current.provider === 'confluence'
            ? stored.excerptLength
            : current.excerptLength,
        aiStatus: stored.aiStatus,
        aiExclusionReason: stored.aiExclusionReason,
      };
    });
    const changed =
      context.sourceJiraVersion !== draft.sourceJiraVersion ||
      refreshedEvidence.some(
        (item) =>
          draft.evidence.find((stored) => stored.id === item.id)?.version !==
          item.version,
      );

    if (!changed) {
      if (
        draft.status === 'draft' &&
        draft.freshnessStatus === 'current'
      ) {
        return this.present(draft);
      }

      // A webhook is only a change signal. Once the draft owner re-reads every
      // selected source with their own OAuth token and the versions still
      // match, clear the signal so it cannot permanently block publication.
      return this.applyRefresh(draft, dto.optimisticVersion, {
        evidence: refreshedEvidence,
        freshnessStatus: 'current',
        status: 'draft',
      });
    }

    return this.applyRefresh(draft, dto.optimisticVersion, {
      sourceJiraVersion: context.sourceJiraVersion as string,
      evidence: refreshedEvidence,
      freshnessStatus: 'review_required',
      status: 'review_required',
    });
  }

  private selectedEvidenceIds(selectedEvidenceIds: string[]): {
    jira: string[];
    confluence: string[];
  } {
    const ids = new Set(selectedEvidenceIds);

    if (ids.size !== selectedEvidenceIds.length) {
      throw new BadRequestException('Selected evidence is invalid.');
    }

    const jira: string[] = [];
    const confluence: string[] = [];
    for (const evidenceId of selectedEvidenceIds) {
      if (evidenceId.startsWith('jira:')) {
        jira.push(evidenceId);
      } else if (evidenceId.startsWith('confluence:')) {
        confluence.push(evidenceId);
      } else {
        throw new BadRequestException('Selected evidence is invalid.');
      }
    }

    return { jira, confluence };
  }

  private selectedJiraEvidence(
    context: JiraDraftContext,
    selectedEvidenceIds: string[],
  ) {
    if (
      context.accessStatus !== 'accessible' ||
      !context.profileId ||
      !context.sourceJiraId ||
      !context.sourceJiraVersion
    ) {
      throw new ConflictException(
        'Selected Jira evidence is no longer accessible.',
      );
    }

    const ids = new Set(selectedEvidenceIds);
    const selected = context.evidence.filter((item) =>
      ids.has(item.evidence.id),
    );
    if (selected.length !== ids.size) {
      throw new BadRequestException('Selected evidence is invalid.');
    }

    return selected;
  }

  private selectedConfluenceEvidence(
    jiraContext: JiraDraftContext,
    confluenceContext: ConfluenceDraftContext | null,
    selectedEvidenceIds: string[],
  ) {
    if (selectedEvidenceIds.length === 0) {
      return [];
    }

    if (
      !confluenceContext ||
      confluenceContext.accessStatus !== 'accessible' ||
      !confluenceContext.profileId ||
      confluenceContext.profileId !== jiraContext.profileId
    ) {
      throw new ConflictException(
        'Selected Confluence evidence is no longer accessible.',
      );
    }

    const ids = new Set(selectedEvidenceIds);
    const selected = confluenceContext.evidence.filter((item) =>
      ids.has(item.evidence.id),
    );

    if (selected.length !== ids.size) {
      throw new BadRequestException('Selected evidence is invalid.');
    }

    return selected;
  }

  private async assertNoExistingDraft(
    profileId: string | null,
    sourceJiraId: string | null,
  ): Promise<void> {
    if (!profileId || !sourceJiraId) {
      throw new ConflictException(
        'Selected Jira evidence is no longer accessible.',
      );
    }

    const existing = await this.draftsRepository.findOneBy({
      profileId,
      sourceJiraId,
    });
    if (existing) {
      this.draftAlreadyExists();
    }
  }

  private draftAlreadyExists(): never {
    throw new ConflictException({
      code: 'DRAFT_ALREADY_EXISTS',
      message: DRAFT_ALREADY_EXISTS_MESSAGE,
    });
  }

  private isDuplicateDraftError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505'
    );
  }

  private contentFromAi(output: WorkBriefOutput): BriefContent {
    const citation = (item: WorkBriefCitation): EvidenceCitation => ({
      text: item.text,
      // Per item, as the model returned it.  Copying the full evidence list
      // onto every item would make the readiness coverage check meaningless.
      evidenceIds: [...item.evidenceIds],
    });

    return {
      title: citation(output.title),
      summary: citation(output.summary),
      requirements: output.keyPoints.map(citation),
      acceptanceCriteria: output.acceptanceCriteria.map(citation),
      risks: output.risks.map(citation),
      nextSteps: output.nextSteps.map(citation),
      childTasks: output.childTasks.map((item) => ({
        ...citation(item),
        // The server owns the identifier, and child task creation stays an
        // explicit last approval step: the model cannot pre-select anything.
        clientTaskId: randomUUID(),
        summary: item.summary,
        selected: false,
      })),
    };
  }

  /**
   * Evidence the model cited anywhere is `included`; everything else is
   * `excluded`, with the model's reason attached when it gave one.
   */
  private evidenceFromAi(
    selectedEvidence: readonly { evidence: NormalizedEvidence }[],
    output: WorkBriefOutput,
    content: BriefContent,
  ): StoredBriefEvidence[] {
    const citedEvidenceIds = new Set(
      this.allCitations(content).flatMap((item) => item.evidenceIds),
    );
    const exclusionReasons = new Map(
      output.excludedEvidence.map((item) => [item.evidenceId, item.reason]),
    );

    return selectedEvidence.map((item) => {
      const included = citedEvidenceIds.has(item.evidence.id);

      return {
        ...item.evidence,
        aiStatus: included ? 'included' : 'excluded',
        aiExclusionReason: included
          ? undefined
          : exclusionReasons.get(item.evidence.id),
      };
    });
  }

  private async maskContent(content: BriefContent): Promise<BriefContent> {
    const citations = this.allCitations(content);
    const values = [
      ...citations.map((item) => item.text),
      ...content.childTasks.map((item) => item.summary),
    ];
    const maskedValues = await this.aiClient.sanitize(values);
    // Child task summaries are appended after every citation text, so they are
    // addressed by offset instead of the running citation index.
    const summaryOffset = citations.length;
    let index = 0;
    const replaceCitation = <T extends EvidenceCitation>(citation: T): T => ({
      ...citation,
      text: maskedValues[index++],
    });

    return {
      title: replaceCitation(content.title),
      summary: replaceCitation(content.summary),
      requirements: content.requirements.map(replaceCitation),
      acceptanceCriteria: content.acceptanceCriteria.map(replaceCitation),
      risks: content.risks.map(replaceCitation),
      nextSteps: content.nextSteps.map(replaceCitation),
      childTasks: content.childTasks.map((childTask, taskIndex) => ({
        ...replaceCitation(childTask),
        summary: maskedValues[summaryOffset + taskIndex],
      })),
    };
  }

  private allCitations(content: BriefContent): EvidenceCitation[] {
    return [
      content.title,
      content.summary,
      ...content.requirements,
      ...content.acceptanceCriteria,
      ...content.risks,
      ...content.nextSteps,
      ...content.childTasks,
    ];
  }

  private async applyRefresh(
    draft: WorkBriefDraft,
    optimisticVersion: number,
    values: Pick<WorkBriefDraft, 'evidence' | 'freshnessStatus' | 'status'> & {
      sourceJiraVersion?: string;
    },
  ): Promise<BriefDraftView> {
    const updated = await this.draftsRepository.update(
      {
        id: draft.id,
        createdByUserId: draft.createdByUserId,
        optimisticVersion,
        // See updateDraft: `update()` does not apply the soft delete filter.
        deletedAt: IsNull(),
      },
      {
        ...values,
        optimisticVersion: optimisticVersion + 1,
        updatedAt: new Date(),
      },
    );
    await this.assertUpdateSucceeded(
      draft.createdByUserId,
      draft.id,
      optimisticVersion,
      updated.affected,
    );

    return this.present(
      await this.findOwnedDraft(draft.createdByUserId, draft.id),
    );
  }

  private async assertUpdateSucceeded(
    userId: number,
    draftId: string,
    expectedVersion: number,
    affected: number | null | undefined,
  ): Promise<void> {
    if (affected === 1) {
      return;
    }

    const latest = await this.findOwnedDraft(userId, draftId);
    this.versionConflict(latest.optimisticVersion, expectedVersion);
  }

  private versionConflict(
    currentVersion: number,
    expectedVersion?: number,
  ): never {
    throw new ConflictException({
      code: 'DRAFT_VERSION_CONFLICT',
      currentVersion,
      ...(expectedVersion ? { expectedVersion } : {}),
    });
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

  /**
   * The single non-disclosure branch.  `present()` and `presentSummary()` must
   * share it: a list that reproduced the rule by hand would eventually drift
   * and leak the title of a draft the user can no longer read (R5).
   */
  private visibility(draft: WorkBriefDraft): {
    accessChanged: boolean;
    blockers: DraftBlocker[];
  } {
    const accessChanged = draft.freshnessStatus === 'access_changed';

    return {
      accessChanged,
      blockers: accessChanged
        ? [{ code: 'ACCESS_CHANGED' as const }]
        : draft.freshnessStatus === 'review_required'
          ? [{ code: 'SOURCE_REVIEW_REQUIRED' as const }]
          : [],
    };
  }

  private presentSummary(
    draft: WorkBriefDraft,
    publication: BriefDraftPublicationSummary | null,
  ): BriefDraftSummary {
    const { accessChanged, blockers } = this.visibility(draft);

    return {
      id: draft.id,
      sourceJiraKey: draft.sourceJiraKey,
      title: accessChanged ? null : (draft.maskedBrief?.title?.text ?? null),
      evidenceCount: accessChanged ? null : draft.evidence.length,
      status: draft.status,
      freshnessStatus: draft.freshnessStatus,
      optimisticVersion: draft.optimisticVersion,
      blockers,
      publication,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    };
  }

  private present(draft: WorkBriefDraft): BriefDraftView {
    const { accessChanged, blockers } = this.visibility(draft);

    return {
      id: draft.id,
      sourceJiraKey: draft.sourceJiraKey,
      sourceJiraVersion: draft.sourceJiraVersion,
      content: accessChanged ? null : draft.maskedBrief,
      evidence: accessChanged ? [] : draft.evidence,
      status: draft.status,
      freshnessStatus: draft.freshnessStatus,
      optimisticVersion: draft.optimisticVersion,
      blockers,
      updatedAt: draft.updatedAt,
    };
  }
}
