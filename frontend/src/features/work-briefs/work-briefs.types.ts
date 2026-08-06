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
  /** Model-authored reason, present only on excluded evidence from schema v2. */
  aiExclusionReason?: string;
  location?: string;
  tags?: string[];
  recommendationReasons?: Array<
    "source_jira" | "linked_jira" | "jira_issue" | "jira_summary"
  >;
};

export type EvidenceCollection = {
  accessStatus: "accessible" | "access_limited" | "not_found";
  evidence: WorkEvidence[];
  recommendations?: WorkEvidence[];
  recommendationAccessStatus?: "accessible" | "access_limited" | "not_found";
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

/**
 * A draft as it appears in the list. Narrower than `BriefDraft` on purpose:
 * the server withholds the title and evidence count once source access has
 * changed, and the response has no field to put them in.
 */
export type BriefDraftSummary = {
  id: string;
  sourceJiraKey: string;
  title: string | null;
  evidenceCount: number | null;
  status: BriefDraft["status"];
  freshnessStatus: BriefDraft["freshnessStatus"];
  optimisticVersion: number;
  blockers: BriefDraft["blockers"];
  publication: {
    id: string;
    status: BriefPublication["status"];
    externalWritePerformed: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
};

/** An issue the user can start a brief from. A picker row, not evidence. */
export type JiraAssignedIssue = {
  issueKey: string;
  projectKey: string;
  title: string;
  url: string;
  updatedAt: string;
};

export type JiraAssignedIssueList = {
  accessStatus: "accessible" | "access_limited" | "not_found";
  issues: JiraAssignedIssue[];
};

export type BriefDraftListView = {
  items: BriefDraftSummary[];
  nextCursor: string | null;
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
  phase: PublicationPhase;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "NEEDS_REVIEW";
  attempts: number;
  errorCode:
    | "CONFLUENCE_VERSION_CONFLICT"
    | "CONFLUENCE_WRITE_FAILED"
    | "PUBLICATION_RECONCILIATION_INDETERMINATE"
    | "JIRA_REMOTE_LINK_FAILED"
    | "JIRA_SUMMARY_COMMENT_FAILED"
    | "JIRA_CHILD_TASK_FAILED"
    | null;
  retryable: boolean;
};

export type PublicationPhase = "confluence" | "jira" | "child_tasks";

export type ConfluencePublicationPreview = {
  phase: "confluence";
  draftVersion: number;
  previewHash: string;
  approvalRevision: number;
  spaceKey: string;
  parentPage: { id: string; title: string; url: string; version: string };
  pageTitle: string;
  bodyPreview: string;
  contentHash: string;
  evidence: Array<{
    id: string;
    provider: "jira" | "confluence";
    title: string;
    url: string;
    version: string;
  }>;
};

export type JiraPublicationPreview = {
  phase: "jira";
  draftVersion: number;
  previewHash: string;
  approvalRevision: number;
  confluencePage: { id: string; url: string; title: string };
  remoteLink: { globalId: string; url: string; title: string };
  summaryComment: { summary: string; url: string };
};

export type ChildTasksPublicationPreview = {
  phase: "child_tasks";
  draftVersion: number;
  previewHash: string;
  approvalRevision: number;
  configurationFingerprint: string;
  childTasks: Array<{
    clientTaskId: string;
    summary: string;
    payload: {
      project: { key: string };
      issueType: { id: string };
      parent: { id: string; key: string };
      fields: Record<string, unknown>;
    };
  }>;
};

export type PublicationPreview =
  | ConfluencePublicationPreview
  | JiraPublicationPreview
  | ChildTasksPublicationPreview;

export type PublicationPreviews = Partial<{
  confluence: ConfluencePublicationPreview;
  jira: JiraPublicationPreview;
  child_tasks: ChildTasksPublicationPreview;
}>;

export type BriefPublication = {
  id: string;
  draftId: string;
  draftVersion: number;
  status:
    | "PENDING"
    | "PUBLISHING"
    | "CONFLUENCE_PUBLISHED"
    | "JIRA_PUBLISHED"
    | "PUBLISHED"
    | "PARTIALLY_PUBLISHED"
    | "NEEDS_REVIEW";
  executionMode: "mock" | "real";
  externalWritePerformed: boolean;
  confluencePage: {
    id: string;
    version: string | null;
    url: string | null;
    contentHash: string | null;
  } | null;
  canRetry: boolean;
  requiresReview: boolean;
  steps: PublicationStep[];
  updatedAt: string;
};
