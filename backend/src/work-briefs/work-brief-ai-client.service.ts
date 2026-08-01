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

export type WorkBriefOutput = {
  title: string;
  summary: string;
  keyPoints: string[];
  risks: string[];
  nextSteps: string[];
  evidenceIds: string[];
};

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
      this.contentGuard.assertSafeModelOutput([
        payload.title,
        payload.summary,
        ...payload.keyPoints,
        ...payload.risks,
        ...payload.nextSteps,
      ]);
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
      typeof candidate.title === 'string' &&
      typeof candidate.summary === 'string' &&
      this.isStringArray(candidate.keyPoints) &&
      this.isStringArray(candidate.risks) &&
      this.isStringArray(candidate.nextSteps) &&
      this.isStringArray(candidate.evidenceIds)
    );
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

  private hasOnlyRequestedEvidence(
    output: WorkBriefOutput,
    evidence: readonly WorkBriefEvidenceInput[],
  ): boolean {
    const requestedEvidenceIds = new Set(
      evidence.map((item) => item.evidenceId),
    );
    return (
      output.evidenceIds.length > 0 &&
      output.evidenceIds.length === new Set(output.evidenceIds).size &&
      output.evidenceIds.every((evidenceId) =>
        requestedEvidenceIds.has(evidenceId),
      )
    );
  }
}
