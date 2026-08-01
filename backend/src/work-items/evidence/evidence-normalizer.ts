import { BadRequestException } from '@nestjs/common';

const MAX_TITLE_LENGTH = 512;
const MAX_VERSION_LENGTH = 255;
const MAX_EXCERPT_LENGTH = 8_000;

export type EvidenceProvider = 'jira' | 'confluence';
export type EvidenceAccessStatus =
  'accessible' | 'access_limited' | 'not_found';
export type EvidenceDlpStatus = 'not_evaluated';

export type NormalizedEvidence = {
  id: string;
  provider: EvidenceProvider;
  sourceId: string;
  url: string;
  title: string;
  version: string;
  excerptLength: number;
  accessStatus: 'accessible';
  dlpStatus: EvidenceDlpStatus;
};

export type EvidenceCollectionResponse = {
  accessStatus: EvidenceAccessStatus;
  evidence: NormalizedEvidence[];
};

export type EvidenceInput = {
  provider: EvidenceProvider;
  sourceId: string;
  url: string;
  title: string;
  version: string;
  excerptSource: unknown;
};

export const normalizeEvidence = (input: EvidenceInput): NormalizedEvidence => {
  const sourceId = boundedValue(input.sourceId, 255, 'Evidence ID is invalid.');
  const title = boundedValue(
    input.title,
    MAX_TITLE_LENGTH,
    'Evidence title is invalid.',
  );
  const version = boundedValue(
    input.version,
    MAX_VERSION_LENGTH,
    'Evidence version is invalid.',
  );
  const url = safeUrl(input.url);

  return {
    id: `${input.provider}:${sourceId}`,
    provider: input.provider,
    sourceId,
    url,
    title,
    version,
    excerptLength: excerptLength(input.excerptSource),
    accessStatus: 'accessible',
    dlpStatus: 'not_evaluated',
  };
};

const boundedValue = (
  value: string,
  maximum: number,
  message: string,
): string => {
  const normalized = value.trim();

  if (!normalized || normalized.length > maximum) {
    throw new BadRequestException(message);
  }

  return normalized;
};

const safeUrl = (value: string): string => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException('Evidence URL is invalid.');
  }

  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new BadRequestException('Evidence URL is invalid.');
  }

  return url.toString();
};

const excerptLength = (value: unknown): number =>
  plainText(value).slice(0, MAX_EXCERPT_LENGTH).length;

const plainText = (value: unknown): string =>
  textParts(value, 0)
    .join(' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const textParts = (value: unknown, depth: number): string[] => {
  if (depth > 24 || value === null || value === undefined) {
    return [];
  }

  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => textParts(item, depth + 1));
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferred = ['value', 'text', 'content']
      .filter((key) => key in record)
      .flatMap((key) => textParts(record[key], depth + 1));

    if (preferred.length > 0) {
      return preferred;
    }
  }

  return [];
};
