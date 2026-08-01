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
