import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  BriefChildTask,
  BriefContent,
  EvidenceCitation,
} from './brief-draft.types';

const MAX_TEXT_LENGTH = 8_000;
const MAX_ITEMS = 20;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class BriefCitationValidatorService {
  validate(
    candidate: unknown,
    allowedEvidenceIds: ReadonlySet<string>,
  ): BriefContent {
    if (!this.isRecord(candidate)) {
      this.invalid();
    }

    const content = candidate;
    const required = [
      'title',
      'summary',
      'requirements',
      'acceptanceCriteria',
      'risks',
      'nextSteps',
      'childTasks',
    ];
    if (
      Object.keys(content).length !== required.length ||
      !required.every((key) => key in content)
    ) {
      this.invalid();
    }

    return {
      title: this.citation(content.title, allowedEvidenceIds),
      summary: this.citation(content.summary, allowedEvidenceIds),
      requirements: this.citations(content.requirements, allowedEvidenceIds),
      acceptanceCriteria: this.citations(
        content.acceptanceCriteria,
        allowedEvidenceIds,
      ),
      risks: this.citations(content.risks, allowedEvidenceIds),
      nextSteps: this.citations(content.nextSteps, allowedEvidenceIds),
      childTasks: this.childTasks(content.childTasks, allowedEvidenceIds),
    };
  }

  private citations(
    value: unknown,
    allowedEvidenceIds: ReadonlySet<string>,
  ): EvidenceCitation[] {
    if (!Array.isArray(value) || value.length > MAX_ITEMS) {
      this.invalid();
    }

    return value.map((item) => this.citation(item, allowedEvidenceIds));
  }

  private childTasks(
    value: unknown,
    allowedEvidenceIds: ReadonlySet<string>,
  ): BriefChildTask[] {
    if (!Array.isArray(value) || value.length > MAX_ITEMS) {
      this.invalid();
    }

    return value.map((item) => {
      if (!this.isRecord(item)) {
        this.invalid();
      }
      const childTask = item;
      const citation = this.citation(childTask, allowedEvidenceIds, [
        'clientTaskId',
        'summary',
        'selected',
      ]);

      if (
        typeof childTask.clientTaskId !== 'string' ||
        !UUID_PATTERN.test(childTask.clientTaskId) ||
        typeof childTask.summary !== 'string' ||
        !childTask.summary.trim() ||
        childTask.summary.length > 512 ||
        typeof childTask.selected !== 'boolean'
      ) {
        this.invalid();
      }

      return {
        ...citation,
        clientTaskId: childTask.clientTaskId,
        summary: childTask.summary.trim(),
        selected: childTask.selected,
      };
    });
  }

  private citation(
    value: unknown,
    allowedEvidenceIds: ReadonlySet<string>,
    additionalKeys: string[] = [],
  ): EvidenceCitation {
    if (!this.isRecord(value)) {
      this.invalid();
    }
    const citation = value;

    if (
      !this.hasOnlyKeys(citation, [
        'text',
        'evidenceIds',
        'userAuthored',
        ...additionalKeys,
      ]) ||
      typeof citation.text !== 'string' ||
      !citation.text.trim() ||
      citation.text.length > MAX_TEXT_LENGTH ||
      (citation.userAuthored !== undefined &&
        typeof citation.userAuthored !== 'boolean')
    ) {
      this.invalid();
    }
    const evidenceIds = this.evidenceIds(
      citation.evidenceIds,
      allowedEvidenceIds,
    );

    return {
      text: citation.text.trim(),
      evidenceIds,
      ...(citation.userAuthored ? { userAuthored: true } : {}),
    };
  }

  private evidenceIds(
    value: unknown,
    allowedEvidenceIds: ReadonlySet<string>,
  ): string[] {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.length > MAX_ITEMS
    ) {
      this.invalid();
    }

    const evidenceIds: string[] = [];
    for (const id of value) {
      if (typeof id !== 'string' || !allowedEvidenceIds.has(id)) {
        this.invalid();
      }
      evidenceIds.push(id);
    }

    if (new Set(evidenceIds).size !== evidenceIds.length) {
      this.invalid();
    }

    return evidenceIds;
  }

  private hasOnlyKeys(
    value: Record<string, unknown>,
    allowed: string[],
  ): boolean {
    return Object.keys(value).every((key) => allowed.includes(key));
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private invalid(): never {
    throw new BadRequestException('Brief citations are invalid.');
  }
}
