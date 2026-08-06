import assert from "node:assert/strict";
import test from "node:test";
import {
  assignedIssueEmptyText,
  matchAssignedIssues,
} from "./assigned-issue-copy.ts";
import type {
  AssignedIssueDraftLookupItem,
  JiraAssignedIssue,
} from "./work-briefs.types.ts";

const issue = (issueKey: string): JiraAssignedIssue => ({
  issueKey,
  projectKey: issueKey.split("-")[0],
  title: `${issueKey} 제목`,
  url: `https://jira.example.test/browse/${issueKey}`,
  updatedAt: "2026-08-02T00:00:00.000+0000",
});

const draft = (
  id: string,
  sourceJiraKey: string,
): AssignedIssueDraftLookupItem => ({ id, sourceJiraKey });

test("marks the issues that already have one of my drafts", () => {
  const rows = matchAssignedIssues(
    [issue("ENG-1"), issue("ENG-2")],
    [draft("draft-1", "ENG-2")],
  );

  assert.deepEqual(
    rows.map((row) => [row.issue.issueKey, row.draftId]),
    [
      ["ENG-1", null],
      ["ENG-2", "draft-1"],
    ],
  );
});

test("keeps the most recently updated draft when an issue has several", () => {
  const rows = matchAssignedIssues(
    [issue("ENG-1")],
    [draft("newer", "ENG-1"), draft("older", "ENG-1")],
  );

  assert.equal(rows[0].draftId, "newer");
});

test("separates an empty assignment list from a failed read", () => {
  assert.match(
    String(assignedIssueEmptyText({ accessStatus: "accessible", issues: [] })),
    /미해결 담당 이슈가 없습니다/,
  );
  assert.match(
    String(
      assignedIssueEmptyText({ accessStatus: "access_limited", issues: [] }),
    ),
    /연결 상태/,
  );
  assert.equal(
    assignedIssueEmptyText({
      accessStatus: "accessible",
      issues: [issue("ENG-1")],
    }),
    null,
  );
  assert.equal(assignedIssueEmptyText(null), null);
});
