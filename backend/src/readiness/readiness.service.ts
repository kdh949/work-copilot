import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  JiraWorkItemService,
  type JiraReadinessContext,
} from '../work-items/jira/jira-work-item.service';
import {
  ConfluenceWorkItemService,
  type ConfluenceEvidenceContext,
} from '../work-items/confluence/confluence-work-item.service';
import { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';
import { ReadinessCoverageEvaluatorService } from './readiness-coverage-evaluator.service';
import { ReadinessAssessment } from './entities/readiness-assessment.entity';
import type {
  ReadinessAssessmentView,
  ReadinessFinding,
  ReadinessStatus,
} from './readiness.types';

@Injectable()
export class ReadinessService {
  constructor(
    @InjectRepository(WorkBriefDraft)
    private readonly draftsRepository: Repository<WorkBriefDraft>,
    @InjectRepository(ReadinessAssessment)
    private readonly assessmentsRepository: Repository<ReadinessAssessment>,
    private readonly jiraWorkItemService: JiraWorkItemService,
    private readonly confluenceWorkItemService: ConfluenceWorkItemService,
    private readonly coverageEvaluator: ReadinessCoverageEvaluatorService,
  ) {}

  async assessDraft(
    userId: number,
    draftId: string,
    correlationId: string,
  ): Promise<ReadinessAssessmentView> {
    const draft = await this.findOwnedDraft(userId, draftId);
    const hasSelectedChildTasks = draft.maskedBrief.childTasks.some(
      (task) => task.selected,
    );
    const context = await this.jiraWorkItemService.collectReadinessContext(
      userId,
      draft.sourceJiraKey,
      correlationId,
      hasSelectedChildTasks,
    );
    const confluenceEvidenceIds = draft.evidence
      .filter((item) => item.provider === 'confluence')
      .map((item) => item.id);
    const confluenceContext =
      context.accessStatus === 'accessible' && confluenceEvidenceIds.length > 0
        ? await this.confluenceWorkItemService.collectEvidenceMetadata(
            userId,
            confluenceEvidenceIds,
            correlationId,
          )
        : null;
    const findings = this.findingsFor(
      draft,
      context,
      confluenceContext,
      hasSelectedChildTasks,
    );
    const status = this.statusFor(findings);
    const assessment = await this.storeAssessment(draft, status, findings);

    return {
      draftId: draft.id,
      assessmentVersion: draft.optimisticVersion,
      status,
      publishAllowed: status === 'READY',
      findings,
      blockers:
        context.accessStatus === 'accessible' ? context.dependencies : [],
      evaluatedAt: assessment.updatedAt,
    };
  }

  async assertDraftPublishAllowed(
    userId: number,
    draftId: string,
    correlationId: string,
  ): Promise<void> {
    const assessment = await this.assessDraft(userId, draftId, correlationId);

    if (!assessment.publishAllowed) {
      throw new ConflictException({ code: 'DRAFT_NOT_READY_FOR_PUBLISH' });
    }
  }

  private findingsFor(
    draft: WorkBriefDraft,
    context: JiraReadinessContext,
    confluenceContext: ConfluenceEvidenceContext | null,
    hasSelectedChildTasks: boolean,
  ): ReadinessFinding[] {
    const findings = this.coverageEvaluator.evaluate(draft.maskedBrief);

    if (draft.freshnessStatus === 'access_changed') {
      findings.push(this.finding('ACCESS_CHANGED'));
    } else if (draft.freshnessStatus !== 'current') {
      findings.push(this.finding('FRESHNESS_REVIEW_REQUIRED'));
    }

    if (
      context.accessStatus !== 'accessible' ||
      !context.profileId ||
      !context.sourceJiraId ||
      !context.sourceJiraVersion
    ) {
      findings.push(this.finding('ACCESS_CHANGED'));
      return this.uniqueFindings(findings);
    }

    if (context.profileId !== draft.profileId) {
      findings.push(this.finding('PROFILE_CHANGED'));
      return this.uniqueFindings(findings);
    }

    if (context.sourceJiraId !== draft.sourceJiraId) {
      findings.push(this.finding('ACCESS_CHANGED'));
      return this.uniqueFindings(findings);
    }

    if (
      confluenceContext !== null &&
      (confluenceContext.accessStatus !== 'accessible' ||
        confluenceContext.profileId !== draft.profileId)
    ) {
      findings.push(this.finding('ACCESS_CHANGED'));
      return this.uniqueFindings(findings);
    }

    this.appendEvidenceFreshnessFindings(
      findings,
      draft,
      context,
      confluenceContext,
    );
    this.appendDependencyFindings(findings, context);
    if (hasSelectedChildTasks) {
      this.appendCreateMetadataFindings(findings, context);
    }

    return this.uniqueFindings(findings);
  }

  private appendEvidenceFreshnessFindings(
    findings: ReadinessFinding[],
    draft: WorkBriefDraft,
    context: JiraReadinessContext,
    confluenceContext: ConfluenceEvidenceContext | null,
  ): void {
    const currentVersions = new Map(
      [
        ...context.evidenceVersions,
        ...(confluenceContext?.evidence.map((item) => ({
          id: item.id,
          version: item.version,
        })) ?? []),
      ].map((item) => [item.id, item.version]),
    );
    const missingEvidence = draft.evidence.some(
      (evidence) => !currentVersions.has(evidence.id),
    );
    const changedEvidence = draft.evidence.some(
      (evidence) => currentVersions.get(evidence.id) !== evidence.version,
    );

    if (
      missingEvidence &&
      (context.hasAccessLimitedEvidence ||
        confluenceContext?.accessStatus === 'access_limited')
    ) {
      findings.push(this.finding('ACCESS_CHANGED'));
    } else if (
      missingEvidence ||
      changedEvidence ||
      context.sourceJiraVersion !== draft.sourceJiraVersion
    ) {
      findings.push(this.finding('FRESHNESS_REVIEW_REQUIRED'));
    }
  }

  private appendDependencyFindings(
    findings: ReadinessFinding[],
    context: JiraReadinessContext,
  ): void {
    for (const dependency of context.dependencies) {
      findings.push(
        this.finding(
          dependency.kind === 'access_limited'
            ? 'ACCESS_LIMITED_DEPENDENCY'
            : 'UNRESOLVED_BLOCKER',
          dependency.kind === 'visible_blocker' ? 'warning' : 'blocking',
        ),
      );
    }
  }

  private appendCreateMetadataFindings(
    findings: ReadinessFinding[],
    context: JiraReadinessContext,
  ): void {
    const template = context.childTaskTemplate;
    if (!template) {
      findings.push(
        this.finding('CREATE_FIELD_MISSING', 'blocking', 'issuetype'),
      );
      return;
    }

    if (context.createMetadata.status === 'access_limited') {
      findings.push(this.finding('CREATE_METADATA_ACCESS_LIMITED'));
      return;
    }
    if (context.createMetadata.status !== 'available') {
      findings.push(this.finding('CREATE_METADATA_UNAVAILABLE'));
      return;
    }

    const suppliedFields = new Set([
      'project',
      'issuetype',
      'parent',
      'summary',
      ...Object.keys(template.fields),
    ]);
    for (const fieldId of context.createMetadata.requiredFieldIds) {
      if (!suppliedFields.has(fieldId)) {
        findings.push(
          this.finding('CREATE_FIELD_MISSING', 'blocking', fieldId),
        );
      }
    }
  }

  private finding(
    code: ReadinessFinding['code'],
    severity: ReadinessFinding['severity'] = 'blocking',
    fieldId?: string,
  ): ReadinessFinding {
    return {
      code,
      severity,
      ...(fieldId ? { fieldId } : {}),
    };
  }

  private uniqueFindings(findings: ReadinessFinding[]): ReadinessFinding[] {
    const unique = new Map<string, ReadinessFinding>();
    for (const finding of findings) {
      const key = JSON.stringify(finding);
      unique.set(key, finding);
    }
    return [...unique.values()];
  }

  private statusFor(findings: readonly ReadinessFinding[]): ReadinessStatus {
    if (
      findings.some(
        (finding) =>
          finding.code === 'ACCESS_CHANGED' ||
          finding.code === 'ACCESS_LIMITED_DEPENDENCY' ||
          finding.code === 'CREATE_METADATA_ACCESS_LIMITED',
      )
    ) {
      return 'ACCESS_LIMITED';
    }
    if (findings.some((finding) => finding.severity === 'blocking')) {
      return 'BLOCKED';
    }
    if (findings.length > 0) {
      return 'NEEDS_ATTENTION';
    }
    return 'READY';
  }

  private async storeAssessment(
    draft: WorkBriefDraft,
    status: ReadinessStatus,
    findings: ReadinessFinding[],
  ): Promise<ReadinessAssessment> {
    const values = {
      sourceJiraId: draft.sourceJiraId,
      status,
      findings,
      updatedAt: new Date(),
    };
    const existing = await this.assessmentsRepository.findOneBy({
      draftId: draft.id,
      assessmentVersion: draft.optimisticVersion,
    });

    if (existing) {
      return this.assessmentsRepository.save(Object.assign(existing, values));
    }

    return this.assessmentsRepository.save(
      this.assessmentsRepository.create({
        draftId: draft.id,
        assessmentVersion: draft.optimisticVersion,
        ...values,
      }),
    );
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
}
