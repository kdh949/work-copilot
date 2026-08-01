export type PublicationStatus =
  | 'PENDING'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'PARTIALLY_PUBLISHED'
  | 'NEEDS_REVIEW';

export type PublicationStepStatus =
  'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'NEEDS_REVIEW';

export type PublicationExecutionMode = 'mock';

export type PublicationErrorCode =
  | 'CONFLUENCE_VERSION_CONFLICT'
  | 'CONFLUENCE_WRITE_FAILED'
  | 'JIRA_REMOTE_LINK_FAILED'
  | 'JIRA_SUMMARY_COMMENT_FAILED'
  | 'JIRA_CHILD_TASK_FAILED';

export type PublicationStepView = {
  key: string;
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
  externalWritePerformed: false;
  canRetry: boolean;
  requiresReview: boolean;
  steps: PublicationStepView[];
  updatedAt: Date;
};
