import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  ) {}

  async generate(
    instruction: string,
    evidence: readonly WorkBriefEvidenceInput[],
  ): Promise<WorkBriefOutput> {
    this.contentGuard.assertSafeRequest(instruction, evidence);

    let response: Response;
    try {
      response = await fetch(`${this.getAiUrl()}/work-brief/generate`, {
        method: 'POST',
        headers: this.getAiHeaders(),
        body: JSON.stringify({ instruction, evidence }),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Work brief AI service is unavailable.',
      );
    }

    if (!response.ok) {
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
      return payload;
    } catch {
      throw new ServiceUnavailableException(
        'Work brief AI service is unavailable.',
      );
    }
  }

  private getAiUrl(): string {
    const configured =
      this.configService.get<string>('AI_SERVICE_URL') ||
      'http://localhost:8000';
    return configured.startsWith('http') ? configured : `https://${configured}`;
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
