import type { PublicationStatus } from '../publications/publication.types';
import type { NormalizedEvidence } from '../work-items/evidence/evidence-normalizer';

export type EvidenceCitation = {
  text: string;
  evidenceIds: string[];
  userAuthored?: boolean;
};

export type BriefChildTask = EvidenceCitation & {
  clientTaskId: string;
  summary: string;
  selected: boolean;
};

export type BriefContent = {
  title: EvidenceCitation;
  summary: EvidenceCitation;
  requirements: EvidenceCitation[];
  acceptanceCriteria: EvidenceCitation[];
  risks: EvidenceCitation[];
  nextSteps: EvidenceCitation[];
  childTasks: BriefChildTask[];
};

export type StoredBriefEvidence = NormalizedEvidence & {
  aiStatus: 'included' | 'excluded';
};

export type DraftStatus = 'draft' | 'review_required';
export type DraftFreshnessStatus =
  'current' | 'review_required' | 'access_changed';

export type DraftBlocker = {
  code: 'SOURCE_REVIEW_REQUIRED' | 'ACCESS_CHANGED';
};

export type BriefDraftView = {
  id: string;
  sourceJiraKey: string;
  sourceJiraVersion: string;
  content: BriefContent | null;
  evidence: StoredBriefEvidence[];
  status: DraftStatus;
  freshnessStatus: DraftFreshnessStatus;
  optimisticVersion: number;
  blockers: DraftBlocker[];
  updatedAt: Date;
};

/**
 * The resume entry point shown on a list row.  Deliberately narrower than
 * `BriefPublicationView`: the list reads stored publication rows only and
 * never runs step recovery, which can call Atlassian.
 */
export type BriefDraftPublicationSummary = {
  id: string;
  status: PublicationStatus;
  externalWritePerformed: boolean;
};

export type BriefDraftSummary = {
  id: string;
  sourceJiraKey: string;
  /** null when access changed — same non-disclosure rule as `BriefDraftView`. */
  title: string | null;
  /** null when access changed. */
  evidenceCount: number | null;
  status: DraftStatus;
  freshnessStatus: DraftFreshnessStatus;
  optimisticVersion: number;
  blockers: DraftBlocker[];
  publication: BriefDraftPublicationSummary | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BriefDraftListView = {
  items: BriefDraftSummary[];
  nextCursor: string | null;
};
