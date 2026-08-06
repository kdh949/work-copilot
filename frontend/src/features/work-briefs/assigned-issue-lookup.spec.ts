import assert from "node:assert/strict";
import test from "node:test";
import { loadAssignedIssueRows } from "./assigned-issue-lookup.ts";
import type {
  AssignedIssueDraftLookup,
  JiraAssignedIssueList,
  WorkBriefApiRequest,
} from "./work-briefs.types.ts";

const assignedIssues = (issueKey: string): JiraAssignedIssueList => ({
  accessStatus: "accessible",
  issues: [
    {
      issueKey,
      projectKey: issueKey.split("-")[0],
      title: `${issueKey} 제목`,
      url: `https://jira.example.test/browse/${issueKey}`,
      updatedAt: "2026-08-02T00:00:00.000Z",
    },
  ],
});

test("does not make an assigned issue actionable before its draft lookup finishes", async () => {
  let resolveLookup: (value: AssignedIssueDraftLookup) => void = () => undefined;
  let lookupStarted = false;
  let settled = false;
  const request: WorkBriefApiRequest = async <T>(path: string): Promise<T> => {
    if (path === "/work-items/jira/my-issues") {
      return assignedIssues("ENG-1") as T;
    }
    lookupStarted = true;
    return new Promise<AssignedIssueDraftLookup>((resolve) => {
      resolveLookup = resolve;
    }) as Promise<T>;
  };

  const loading = loadAssignedIssueRows(request, async () => undefined).then(
    (result) => {
      settled = true;
      return result;
    },
  );
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(lookupStarted, true);
  assert.equal(settled, false);

  resolveLookup({ items: [{ id: "draft-1", sourceJiraKey: "ENG-1" }] });
  const result = await loading;
  assert.deepEqual(
    result.rows.map((row) => [row.issue.issueKey, row.draftId]),
    [["ENG-1", "draft-1"]],
  );
});

test("uses the bulk lookup when the matching draft is beyond the first list page", async () => {
  const request: WorkBriefApiRequest = async <T>(path: string): Promise<T> => {
    if (path === "/work-items/jira/my-issues") {
      return assignedIssues("ENG-21") as T;
    }
    return {
      items: [{ id: "draft-21", sourceJiraKey: "ENG-21" }],
    } satisfies AssignedIssueDraftLookup as T;
  };

  const result = await loadAssignedIssueRows(request, async () => undefined);

  assert.equal(result.rows[0]?.draftId, "draft-21");
});

test("uses only the active profile's same-key draft returned by the server", async () => {
  const request: WorkBriefApiRequest = async <T>(path: string): Promise<T> => {
    if (path === "/work-items/jira/my-issues") {
      return assignedIssues("ENG-1") as T;
    }
    return {
      items: [{ id: "profile-b-draft", sourceJiraKey: "ENG-1" }],
    } satisfies AssignedIssueDraftLookup as T;
  };

  const result = await loadAssignedIssueRows(request, async () => undefined);

  assert.equal(result.rows[0]?.draftId, "profile-b-draft");
});

test("refreshes the connection status after the assigned-issues provider call", async () => {
  let refreshCount = 0;
  const request: WorkBriefApiRequest = async <T>(path: string): Promise<T> => {
    if (path === "/work-items/jira/my-issues") {
      return { accessStatus: "accessible", issues: [] } as T;
    }
    throw new Error(`unexpected route: ${path}`);
  };

  await loadAssignedIssueRows(request, async () => {
    refreshCount += 1;
  });
  await Promise.resolve();

  assert.equal(refreshCount, 1);
});
