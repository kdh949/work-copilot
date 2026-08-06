import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SecurityAuditEvent } from '../integrations/profiles/entities/security-audit-event.entity';
import { WorkCopilotMetricsService } from './work-copilot-metrics.service';

type SafeAuditInput = {
  actorUserId: number | null;
  action: string;
  profileId: string | null;
  targetId: string | null;
  correlationId: string;
  resultCode: string;
};

const SAFE_EVENT_VALUE = /^[A-Za-z0-9:._-]{1,128}$/;
const SAFE_EVENT_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const SENSITIVE_EVENT_VALUE_PATTERNS = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/i,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/,
  /(?:^|[/:])\.env(?:[./:]|$)/i,
];

@Injectable()
export class SafeAuditService {
  constructor(
    @InjectRepository(SecurityAuditEvent)
    private readonly auditRepository: Repository<SecurityAuditEvent>,
    private readonly metrics: WorkCopilotMetricsService,
  ) {}

  async record(input: SafeAuditInput): Promise<void> {
    if (!this.isSafeInput(input)) {
      this.metrics.increment('audit_write_failure_total', {
        outcome: 'blocked',
      });
      return;
    }

    try {
      await this.auditRepository.save(
        this.auditRepository.create({
          actorUserId: input.actorUserId,
          action: input.action,
          profileId: input.profileId,
          targetId: input.targetId,
          correlationId: input.correlationId,
          resultCode: input.resultCode,
        }),
      );
    } catch {
      // Audit metadata is intentionally bounded; never log request bodies or errors.
      this.metrics.increment('audit_write_failure_total', {
        outcome: 'failure',
      });
    }
  }

  private isSafeInput(input: SafeAuditInput): boolean {
    return (
      SAFE_EVENT_CODE.test(input.action) &&
      SAFE_EVENT_CODE.test(input.resultCode) &&
      this.isSafeValue(input.correlationId) &&
      (input.actorUserId === null ||
        (Number.isSafeInteger(input.actorUserId) && input.actorUserId > 0)) &&
      (input.profileId === null || this.isSafeValue(input.profileId)) &&
      (input.targetId === null || this.isSafeValue(input.targetId))
    );
  }

  private isSafeValue(value: string): boolean {
    return (
      SAFE_EVENT_VALUE.test(value) &&
      !SENSITIVE_EVENT_VALUE_PATTERNS.some((pattern) => pattern.test(value))
    );
  }
}
