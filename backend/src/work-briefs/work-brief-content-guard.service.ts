import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';

export type WorkBriefEvidenceInput = {
  evidenceId: string;
  content: string;
};

const SECRET_PATTERNS = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/i,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/,
  /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s'"`]+/i,
  /(?:^|[\r\n])\s*[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|DB_URI)\s*=/m,
  /\b(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*['"]?[A-Za-z0-9_./+=-]{8,}/i,
  /(?:^|[/:])\.env(?:[./:]|$)/i,
];

@Injectable()
export class WorkBriefContentGuard {
  static readonly MAX_EVIDENCE_ITEMS = 20;
  static readonly MAX_EVIDENCE_CHARS = 8_000;
  static readonly MAX_TOTAL_EVIDENCE_CHARS = 64_000;
  static readonly MAX_INSTRUCTION_CHARS = 2_000;

  assertSafeRequest(
    instruction: string,
    evidence: readonly WorkBriefEvidenceInput[],
  ): void {
    this.assertLength(instruction, WorkBriefContentGuard.MAX_INSTRUCTION_CHARS);

    if (evidence.length > WorkBriefContentGuard.MAX_EVIDENCE_ITEMS) {
      throw new PayloadTooLargeException('Work brief evidence is too large.');
    }

    let totalChars = instruction.length;
    for (const item of evidence) {
      this.assertLength(item.content, WorkBriefContentGuard.MAX_EVIDENCE_CHARS);
      totalChars += item.content.length;
      this.assertNoSecret(item.evidenceId);
      this.assertNoSecret(item.content);
    }

    if (totalChars > WorkBriefContentGuard.MAX_TOTAL_EVIDENCE_CHARS) {
      throw new PayloadTooLargeException('Work brief evidence is too large.');
    }

    this.assertNoSecret(instruction);
  }

  assertSafeFragment(evidenceId: string, content: string): void {
    this.assertLength(content, WorkBriefContentGuard.MAX_EVIDENCE_CHARS);
    this.assertNoSecret(evidenceId);
    this.assertNoSecret(content);
  }

  assertSafeModelOutput(values: readonly string[]): void {
    for (const value of values) {
      this.assertLength(value, WorkBriefContentGuard.MAX_EVIDENCE_CHARS);
      this.assertNoSecret(value);
    }
  }

  private assertLength(value: string, maxLength: number): void {
    if (value.length > maxLength) {
      throw new PayloadTooLargeException('Work brief evidence is too large.');
    }
  }

  private assertNoSecret(value: string): void {
    if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
      throw new BadRequestException('Sensitive content cannot be processed.');
    }
  }
}
