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
  updatedAt?: string;
  location?: string;
  tags?: string[];
  state?: "current" | "review" | "restricted";
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

export type ReadinessFinding = {
  code:
    | "COVERAGE_MISSING"
    | "CREATE_FIELD_MISSING"
    | "CREATE_METADATA_ACCESS_LIMITED"
    | "CREATE_METADATA_UNAVAILABLE"
    | "UNRESOLVED_BLOCKER"
    | "ACCESS_LIMITED_DEPENDENCY"
    | "FRESHNESS_REVIEW_REQUIRED"
    | "ACCESS_CHANGED"
    | "PROFILE_CHANGED";
  severity: "blocking" | "warning";
  requirementIndex?: number;
  missing?: ("child_task" | "verification_evidence")[];
  fieldId?: string;
  evidenceIds?: string[];
};

export type ReadinessBlocker =
  | {
      kind: "visible_blocker";
      issueKey: string;
      url: string;
      crossProject: boolean;
    }
  | { kind: "access_limited" };

export type ReadinessAssessment = {
  draftId: string;
  assessmentVersion: number;
  status: "READY" | "NEEDS_ATTENTION" | "BLOCKED" | "ACCESS_LIMITED";
  publishAllowed: boolean;
  findings: ReadinessFinding[];
  blockers: ReadinessBlocker[];
  evaluatedAt: string;
};

export type PublicationStep = {
  key: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "NEEDS_REVIEW";
  attempts: number;
  errorCode:
    | "CONFLUENCE_VERSION_CONFLICT"
    | "CONFLUENCE_WRITE_FAILED"
    | "JIRA_REMOTE_LINK_FAILED"
    | "JIRA_SUMMARY_COMMENT_FAILED"
    | "JIRA_CHILD_TASK_FAILED"
    | null;
  retryable: boolean;
};

export type BriefPublication = {
  id: string;
  draftId: string;
  draftVersion: number;
  status:
    | "PENDING"
    | "PUBLISHING"
    | "PUBLISHED"
    | "PARTIALLY_PUBLISHED"
    | "NEEDS_REVIEW";
  executionMode: "mock";
  externalWritePerformed: false;
  canRetry: boolean;
  requiresReview: boolean;
  steps: PublicationStep[];
  updatedAt: string;
};
