import type { PublicationStep } from "./work-briefs.types";

export const stepStatusLabel: Record<PublicationStep["status"], string> = {
  PENDING: "대기",
  RUNNING: "실행 중",
  SUCCEEDED: "완료",
  FAILED: "실패",
  NEEDS_REVIEW: "재승인 필요",
};

/**
 * User-facing wording for provider write failures.
 *
 * `docs/jira-confluence-publication-operations.md` is the source of truth for
 * what each code means. RECONCILIATION_INDETERMINATE is the one that must not
 * be retried blindly — the operations runbook marks it non-retryable because
 * the write may already have landed, and this sentence is the only thing
 * standing between the user and a duplicate Jira issue.
 */
export const stepErrorDescription: Record<
  NonNullable<PublicationStep["errorCode"]>,
  string
> = {
  CONFLUENCE_VERSION_CONFLICT:
    "Confluence 페이지가 다른 곳에서 수정되었습니다. 미리보기를 다시 열고 승인하세요.",
  CONFLUENCE_WRITE_FAILED:
    "Confluence 페이지를 만들지 못했습니다. 다시 시도할 수 있습니다.",
  PUBLICATION_RECONCILIATION_INDETERMINATE:
    "외부 반영 결과를 확인할 수 없습니다. Jira·Confluence에서 실제로 만들어졌는지 먼저 확인하세요. 바로 재시도하면 중복이 생길 수 있습니다.",
  JIRA_REMOTE_LINK_FAILED:
    "Jira remote link를 반영하지 못했습니다. 다시 시도할 수 있습니다.",
  JIRA_SUMMARY_COMMENT_FAILED:
    "Jira 요약 댓글을 반영하지 못했습니다. 다시 시도할 수 있습니다.",
  JIRA_CHILD_TASK_FAILED:
    "Jira 하위 작업을 만들지 못했습니다. 다시 시도할 수 있습니다.",
};
