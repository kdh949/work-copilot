import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ConfluenceWorkItemService,
  type ConfluenceDraftContext,
} from '../work-items/confluence/confluence-work-item.service';
import type { JiraDraftContext } from '../work-items/jira/jira-work-item.service';
import { JiraWorkItemService } from '../work-items/jira/jira-work-item.service';
import { BriefCitationValidatorService } from './brief-citation-validator.service';
import type {
  BriefContent,
  BriefDraftView,
  EvidenceCitation,
  StoredBriefEvidence,
} from './brief-draft.types';
import {
  CreateBriefDraftDto,
  RefreshBriefDraftDto,
  UpdateBriefDraftDto,
} from './dto/brief-draft.dto';
import {
  WorkBriefAiClientService,
  type WorkBriefOutput,
} from './work-brief-ai-client.service';
import { WorkBriefDraft } from './entities/work-brief-draft.entity';

@Injectable()
export class WorkBriefsService {
  constructor(
    @InjectRepository(WorkBriefDraft)
    private readonly draftsRepository: Repository<WorkBriefDraft>,
    private readonly jiraWorkItemService: JiraWorkItemService,
    private readonly confluenceWorkItemService: ConfluenceWorkItemService,
    private readonly aiClient: WorkBriefAiClientService,
    private readonly citationValidator: BriefCitationValidatorService,
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
    const evidence: StoredBriefEvidence[] = selectedEvidence.map((item) => ({
      ...item.evidence,
      aiStatus: output.evidenceIds.includes(item.evidence.id)
        ? 'included'
        : 'excluded',
    }));

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
        throw new ConflictException(
          'A brief draft already exists for this source.',
        );
      }
      throw error;
    }

    return this.present(stored);
  }

  async findDraft(userId: number, draftId: string): Promise<BriefDraftView> {
    return this.present(await this.findOwnedDraft(userId, draftId));
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
      throw new ConflictException(
        'A brief draft already exists for this source.',
      );
    }
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
    const citation = (text: string): EvidenceCitation => ({
      text,
      evidenceIds: [...output.evidenceIds],
    });

    return {
      title: citation(output.title),
      summary: citation(output.summary),
      requirements: output.keyPoints.map(citation),
      acceptanceCriteria: [],
      risks: output.risks.map(citation),
      nextSteps: output.nextSteps.map(citation),
      childTasks: [],
    };
  }

  private async maskContent(content: BriefContent): Promise<BriefContent> {
    const citations = this.allCitations(content);
    const values = [
      ...citations.map((item) => item.text),
      ...content.childTasks.map((item) => item.summary),
    ];
    const maskedValues = await this.aiClient.sanitize(values);
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
      childTasks: content.childTasks.map((childTask) => ({
        ...replaceCitation(childTask),
        summary: maskedValues[index++],
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

  private present(draft: WorkBriefDraft): BriefDraftView {
    const accessChanged = draft.freshnessStatus === 'access_changed';
    const blockers = accessChanged
      ? [{ code: 'ACCESS_CHANGED' as const }]
      : draft.freshnessStatus === 'review_required'
        ? [{ code: 'SOURCE_REVIEW_REQUIRED' as const }]
        : [];

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
