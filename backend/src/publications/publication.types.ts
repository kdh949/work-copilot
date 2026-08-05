export type PublicationStatus =
  | 'PENDING'
  | 'PUBLISHING'
  | 'CONFLUENCE_PUBLISHED'
  | 'JIRA_PUBLISHED'
  | 'PUBLISHED'
  | 'PARTIALLY_PUBLISHED'
  | 'NEEDS_REVIEW';

export type PublicationPhase = 'confluence' | 'jira' | 'child_tasks';

export type PublicationStepStatus =
  'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'NEEDS_REVIEW';

export type PublicationExecutionMode = 'mock' | 'real';

export type PublicationErrorCode =
  | 'CONFLUENCE_VERSION_CONFLICT'
  | 'CONFLUENCE_WRITE_FAILED'
  | 'PUBLICATION_RECONCILIATION_INDETERMINATE'
  | 'JIRA_REMOTE_LINK_FAILED'
  | 'JIRA_SUMMARY_COMMENT_FAILED'
  | 'JIRA_CHILD_TASK_FAILED';

export type PublicationStepView = {
  key: string;
  phase: PublicationPhase;
  status: PublicationStepStatus;
  attempts: number;
  errorCode: PublicationErrorCode | null;
  retryable: boolean;
};

export type BriefPublicationView = {
  id: string;
  draftId: string;
  draftVersion: number;
  status: PublicationStatus;
  executionMode: PublicationExecutionMode;
  externalWritePerformed: boolean;
  confluencePage: {
    id: string;
    version: string | null;
    url: string | null;
    contentHash: string | null;
  } | null;
  canRetry: boolean;
  requiresReview: boolean;
  steps: PublicationStepView[];
  updatedAt: Date;
};
