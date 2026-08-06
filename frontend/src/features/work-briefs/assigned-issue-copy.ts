import type {
  BriefDraftSummary,
  JiraAssignedIssue,
  JiraAssignedIssueList,
} from "./work-briefs.types";

export type AssignedIssueRow = {
  issue: JiraAssignedIssue;
  /** The user's existing draft for this issue, if the list already has one. */
  draftId: string | null;
};

/**
 * Match assigned issues against the drafts already on screen.
 *
 * The pairing is done here rather than on the server: the draft list is
 * own-drafts-only and already loaded, so asking the API again would add a
 * query and a second, weaker copy of the visibility rule. A colleague's draft
 * stays invisible either way and still surfaces as the 409 on create.
 */
export function matchAssignedIssues(
  issues: readonly JiraAssignedIssue[],
  drafts: readonly BriefDraftSummary[],
): AssignedIssueRow[] {
  const draftIdByIssueKey = new Map<string, string>();
  for (const draft of drafts) {
    // The list is ordered by updatedAt desc, so the first match is the one the
    // user worked on most recently.
    if (!draftIdByIssueKey.has(draft.sourceJiraKey)) {
      draftIdByIssueKey.set(draft.sourceJiraKey, draft.id);
    }
  }

  return issues.map((issue) => ({
    issue,
    draftId: draftIdByIssueKey.get(issue.issueKey) ?? null,
  }));
}

/**
 * What to say when the picker has nothing to show. An empty list and a failed
 * read look identical, and only one of them is worth acting on.
 */
export function assignedIssueEmptyText(
  list: JiraAssignedIssueList | null,
): string | null {
  if (!list) return null;
  if (list.accessStatus === "access_limited") {
    return "현재 권한으로 담당 이슈를 읽을 수 없습니다. Jira 연결 상태를 확인하세요.";
  }
  if (list.accessStatus === "not_found") {
    return "담당 이슈를 조회할 수 없습니다. 허용된 프로젝트 설정을 확인하세요.";
  }
  return list.issues.length === 0
    ? "허용된 프로젝트에 미해결 담당 이슈가 없습니다. 이슈 키를 직접 입력해 시작하세요."
    : null;
}

export const ASSIGNED_ISSUE_DRAFT_BADGE = "초안 있음";
