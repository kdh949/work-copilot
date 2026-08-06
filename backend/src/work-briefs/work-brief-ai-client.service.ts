import {
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkCopilotMetricsService } from '../operations/work-copilot-metrics.service';
import {
  WorkBriefContentGuard,
  type WorkBriefEvidenceInput,
} from './work-brief-content-guard.service';

export const WORK_BRIEF_SCHEMA_VERSION = 2;

export type WorkBriefCitation = {
  text: string;
  evidenceIds: string[];
};

export type WorkBriefChildTaskOutput = WorkBriefCitation & {
  summary: string;
};

export type WorkBriefExcludedEvidence = {
  evidenceId: string;
  reason: string;
};

/**
 * Schema v2.  Every item carries its own `evidenceIds`; there is no
 * response-level evidence list to copy onto each item.
 */
export type WorkBriefOutput = {
  schemaVersion: number;
  title: WorkBriefCitation;
  summary: WorkBriefCitation;
  keyPoints: WorkBriefCitation[];
  acceptanceCriteria: WorkBriefCitation[];
  risks: WorkBriefCitation[];
  nextSteps: WorkBriefCitation[];
  childTasks: WorkBriefChildTaskOutput[];
  excludedEvidence: WorkBriefExcludedEvidence[];
};

const CITATION_LIST_FIELDS = [
  'keyPoints',
  'acceptanceCriteria',
  'risks',
  'nextSteps',
] as const;

@Injectable()
export class WorkBriefAiClientService {
  constructor(
    private readonly configService: ConfigService,
    private readonly contentGuard: WorkBriefContentGuard,
    @Optional() private readonly metrics?: WorkCopilotMetricsService,
  ) {}

  async generate(
    instruction: string,
    evidence: readonly WorkBriefEvidenceInput[],
  ): Promise<WorkBriefOutput> {
    const startedAt = Date.now();
    this.contentGuard.assertSafeRequest(instruction, evidence);

    let response: Response;
    try {
      response = await fetch(`${this.getAiUrl()}/work-brief/generate`, {
        method: 'POST',
        headers: this.getAiHeaders(),
        body: JSON.stringify({ instruction, evidence }),
      });
    } catch {
      this.recordDuration('generate', 'failure', startedAt);
      throw new ServiceUnavailableException(
        'Work brief AI service is unavailable.',
      );
    }

    if (!response.ok) {
      this.recordDuration('generate', 'failure', startedAt);
      throw new ServiceUnavailableException(
        'Work brief AI service is unavailable.',
      );
    }

    try {
      const payload: unknown = await response.json();
      if (!this.isWorkBriefOutput(payload)) {
        throw new Error('invalid work brief response');
      }
      this.contentGuard.assertSafeModelOutput(this.modelText(payload));
      if (!this.hasOnlyRequestedEvidence(payload, evidence)) {
        throw new Error('invalid work brief evidence');
      }
      this.recordDuration('generate', 'success', startedAt);
      return payload;
    } catch {
      this.recordDuration('generate', 'failure', startedAt);
      throw new ServiceUnavailableException(
        'Work brief AI service is unavailable.',
      );
    }
  }

  async sanitize(values: readonly string[]): Promise<string[]> {
    const startedAt = Date.now();
    this.contentGuard.assertSafeModelOutput(values);

    let response: Response;
    try {
      response = await fetch(`${this.getAiUrl()}/work-brief/sanitize`, {
        method: 'POST',
        headers: this.getAiHeaders(),
        body: JSON.stringify({ values }),
      });
    } catch {
      this.recordDuration('sanitize', 'failure', startedAt);
      throw new ServiceUnavailableException(
        'Work brief DLP service is unavailable.',
      );
    }

    if (!response.ok) {
      this.recordDuration('sanitize', 'failure', startedAt);
      throw new ServiceUnavailableException(
        'Work brief DLP service is unavailable.',
      );
    }

    try {
      const payload: unknown = await response.json();
      if (!this.isSanitizedValues(payload, values.length)) {
        throw new Error('invalid work brief DLP response');
      }
      this.contentGuard.assertSafeModelOutput(payload.values);
      this.recordDuration('sanitize', 'success', startedAt);
      return payload.values;
    } catch {
      this.recordDuration('sanitize', 'failure', startedAt);
      throw new ServiceUnavailableException(
        'Work brief DLP service is unavailable.',
      );
    }
  }

  private getAiUrl(): string {
    const configured =
      this.configService.get<string>('AI_SERVICE_URL') ||
      'http://localhost:8000';
    return configured.startsWith('http') ? configured : `https://${configured}`;
  }

  private recordDuration(
    operation: 'generate' | 'sanitize',
    outcome: 'success' | 'failure',
    startedAt: number,
  ): void {
    this.metrics?.observeDuration(
      'work_brief_ai_duration_ms',
      { operation, outcome },
      Date.now() - startedAt,
    );
  }

  private getAiHeaders(): Record<string, string> {
    const apiKey = this.configService.get<string>('AI_SERVICE_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Work brief AI service is unavailable.',
      );
    }

    return {
      'Content-Type': 'application/json',
      'X-AI-Service-Key': apiKey,
    };
  }

  private isWorkBriefOutput(value: unknown): value is WorkBriefOutput {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Record<string, unknown>;
    return (
      candidate.schemaVersion === WORK_BRIEF_SCHEMA_VERSION &&
      this.isCitation(candidate.title) &&
      this.isCitation(candidate.summary) &&
      CITATION_LIST_FIELDS.every(
        (field) =>
          Array.isArray(candidate[field]) &&
          (candidate[field] as unknown[]).every((item) =>
            this.isCitation(item),
          ),
      ) &&
      Array.isArray(candidate.childTasks) &&
      candidate.childTasks.every(
        (item) =>
          this.isCitation(item) &&
          typeof (item as Record<string, unknown>).summary === 'string',
      ) &&
      Array.isArray(candidate.excludedEvidence) &&
      candidate.excludedEvidence.every((item) => this.isExcludedEvidence(item))
    );
  }

  private isCitation(value: unknown): value is WorkBriefCitation {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate.text === 'string' &&
      this.isStringArray(candidate.evidenceIds)
    );
  }

  private isExcludedEvidence(
    value: unknown,
  ): value is WorkBriefExcludedEvidence {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate.evidenceId === 'string' &&
      typeof candidate.reason === 'string'
    );
  }

  /** Every model-authored string, including the v2 fields (R8). */
  private modelText(output: WorkBriefOutput): string[] {
    return [
      output.title.text,
      output.summary.text,
      ...CITATION_LIST_FIELDS.flatMap((field) =>
        output[field].map((item) => item.text),
      ),
      ...output.childTasks.flatMap((item) => [item.summary, item.text]),
      ...output.excludedEvidence.map((item) => item.reason),
    ];
  }

  private isStringArray(value: unknown): value is string[] {
    return (
      Array.isArray(value) && value.every((item) => typeof item === 'string')
    );
  }

  private isSanitizedValues(
    value: unknown,
    expectedLength: number,
  ): value is { values: string[] } {
    return (
      !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      this.isStringArray((value as Record<string, unknown>).values) &&
      (value as { values: string[] }).values.length === expectedLength
    );
  }

  /**
   * Per item, not per response.  A whole-response check passes for an output
   * that copies every requested evidence id onto every item, which is the
   * citation quality problem schema v2 exists to fix.
   */
  private hasOnlyRequestedEvidence(
    output: WorkBriefOutput,
    evidence: readonly WorkBriefEvidenceInput[],
  ): boolean {
    const requestedEvidenceIds = new Set(
      evidence.map((item) => item.evidenceId),
    );
    const citations: WorkBriefCitation[] = [
      output.title,
      output.summary,
      ...CITATION_LIST_FIELDS.flatMap((field) => output[field]),
      ...output.childTasks,
    ];
    const citedEvidenceIds = new Set<string>();
    const citationEvidenceSets: Set<string>[] = [];
    for (const citation of citations) {
      if (
        citation.evidenceIds.length === 0 ||
        citation.evidenceIds.length !== new Set(citation.evidenceIds).size ||
        citation.evidenceIds.some(
          (evidenceId) => !requestedEvidenceIds.has(evidenceId),
        )
      ) {
        return false;
      }
      citationEvidenceSets.push(new Set(citation.evidenceIds));
      for (const evidenceId of citation.evidenceIds) {
        citedEvidenceIds.add(evidenceId);
      }
    }

    if (!citedEvidenceIds.size) {
      return false;
    }

    const excludedEvidenceIds = new Set<string>();
    for (const item of output.excludedEvidence) {
      // Evidence cannot be both the basis for an item and unusable, and every
      // omitted source needs one explicit exclusion reason.
      if (
        !requestedEvidenceIds.has(item.evidenceId) ||
        citedEvidenceIds.has(item.evidenceId) ||
        excludedEvidenceIds.has(item.evidenceId)
      ) {
        return false;
      }
      excludedEvidenceIds.add(item.evidenceId);
    }

    if (
      [...requestedEvidenceIds].some(
        (evidenceId) =>
          !citedEvidenceIds.has(evidenceId) &&
          !excludedEvidenceIds.has(evidenceId),
      )
    ) {
      return false;
    }

    if (
      requestedEvidenceIds.size > 1 &&
      citationEvidenceSets.every(
        (citationEvidenceIds) =>
          citationEvidenceIds.size === requestedEvidenceIds.size &&
          [...requestedEvidenceIds].every((evidenceId) =>
            citationEvidenceIds.has(evidenceId),
          ),
      )
    ) {
      return false;
    }

    return output.keyPoints.every((requirement) => {
      const sharesEvidence = (citation: WorkBriefCitation) =>
        citation.evidenceIds.some((evidenceId) =>
          requirement.evidenceIds.includes(evidenceId),
        );
      return (
        output.acceptanceCriteria.some(sharesEvidence) &&
        output.childTasks.some(sharesEvidence)
      );
    });
  }
}
