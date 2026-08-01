import type { ApiRequest } from "../admin/integration-profile.types";

export type WorkBriefApiRequest = ApiRequest;

export type WorkEvidence = {
  id: string;
  provider: "jira" | "confluence";
  sourceId: string;
  url: string;
  title: string;
  version: string;
  excerptLength: number;
  accessStatus: "accessible";
  dlpStatus: "not_evaluated";
  aiStatus?: "included" | "excluded";
};

export type EvidenceCollection = {
  accessStatus: "accessible" | "access_limited" | "not_found";
  evidence: WorkEvidence[];
};

export type EvidenceCitation = {
  text: string;
  evidenceIds: string[];
  userAuthored?: boolean;
};

export type ChildTask = EvidenceCitation & {
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
  childTasks: ChildTask[];
};

export type BriefDraft = {
  id: string;
  sourceJiraKey: string;
  sourceJiraVersion: string;
  content: BriefContent | null;
  evidence: (WorkEvidence & { aiStatus: "included" | "excluded" })[];
  status: "draft" | "review_required";
  freshnessStatus: "current" | "review_required" | "access_changed";
  optimisticVersion: number;
  blockers: { code: "SOURCE_REVIEW_REQUIRED" | "ACCESS_CHANGED" }[];
  updatedAt: string;
};
