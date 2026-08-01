import { Injectable } from '@nestjs/common';
import type { SourceChangeProvider } from './entities/source-change-event.entity';

export type ParsedSourceChange = {
  sourceId: string;
  sourceVersion: string;
  eventTime: Date;
  operationId: string | null;
};

const SAFE_SOURCE_VALUE = /^[A-Za-z0-9:._-]{1,128}$/;
const SAFE_OPERATION_ID = /^[A-Za-z0-9-]{1,128}$/;
const SENSITIVE_SOURCE_VALUE_PATTERNS = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/i,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/,
  /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s'"`]+/i,
  /(?:^|[/:])\.env(?:[./:]|$)/i,
];

@Injectable()
export class WebhookPayloadParserService {
  parse(
    provider: SourceChangeProvider,
    payload: unknown,
  ): ParsedSourceChange | null {
    const root = this.record(payload);
    if (!root) {
      return null;
    }

    const source =
      provider === 'jira'
        ? this.record(root.issue)
        : (this.record(root.page) ?? this.record(root.content));
    if (!source) {
      return null;
    }

    const sourceId = this.safeValue(source.id);
    const sourceVersion =
      provider === 'jira'
        ? (this.safeValue(source.updated) ?? this.safeValue(root.timestamp))
        : (this.safeValue(this.record(source.version)?.number) ??
          this.safeValue(source.updated) ??
          this.safeValue(root.timestamp));
    if (!sourceId || !sourceVersion) {
      return null;
    }

    const eventTime = this.eventTime(
      root.timestamp ?? root.eventTime ?? source.updated,
    );
    if (!eventTime) {
      return null;
    }

    return {
      sourceId,
      sourceVersion,
      eventTime,
      operationId: this.operationId(root.operationId),
    };
  }

  private record(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private safeValue(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return null;
    }

    const normalized = String(value).trim();
    return SAFE_SOURCE_VALUE.test(normalized) &&
      !SENSITIVE_SOURCE_VALUE_PATTERNS.some((pattern) =>
        pattern.test(normalized),
      )
      ? normalized
      : null;
  }

  private operationId(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return SAFE_OPERATION_ID.test(normalized) ? normalized : null;
  }

  private eventTime(value: unknown): Date | null {
    const timestamp =
      typeof value === 'number'
        ? new Date(value)
        : typeof value === 'string'
          ? new Date(value)
          : null;

    if (!timestamp || Number.isNaN(timestamp.getTime())) {
      return null;
    }

    return timestamp;
  }
}
