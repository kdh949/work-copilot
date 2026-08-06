import {
  matchAssignedIssues,
  type AssignedIssueRow,
} from "./assigned-issue-copy.ts";
import { withConnectionStatusRefresh } from "./work-brief-guards.ts";
import type {
  AssignedIssueDraftLookup,
  JiraAssignedIssueList,
  WorkBriefApiRequest,
} from "./work-briefs.types";

export type AssignedIssueRows = {
  list: JiraAssignedIssueList;
  rows: AssignedIssueRow[];
};

/**
 * Read the provider's assigned issues and then atomically obtain the only
 * draft identities that can be opened for those issues. The caller must wait
 * for this whole operation before making a row actionable: a first page of
 * `/brief-drafts` is neither complete nor profile-scoped enough for this.
 */
export async function loadAssignedIssueRows(
  request: WorkBriefApiRequest,
  refreshConnections: () => Promise<void>,
): Promise<AssignedIssueRows> {
  const list = await withConnectionStatusRefresh(
    () => request<JiraAssignedIssueList>("/work-items/jira/my-issues"),
    refreshConnections,
  );

  if (list.issues.length === 0) {
    return { list, rows: [] };
  }

  const lookup = await request<AssignedIssueDraftLookup>(
    "/brief-drafts/lookup",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceJiraKeys: list.issues.map((issue) => issue.issueKey),
      }),
    },
  );

  return { list, rows: matchAssignedIssues(list.issues, lookup.items) };
}
