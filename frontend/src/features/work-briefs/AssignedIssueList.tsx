import { useEffect, useRef, useState } from "react";
import { Badge, Button } from "../../design-system/components";
import {
  ASSIGNED_ISSUE_DRAFT_BADGE,
  assignedIssueEmptyText,
} from "./assigned-issue-copy";
import {
  loadAssignedIssueRows,
  type AssignedIssueRows,
} from "./assigned-issue-lookup";
import type {
  JiraAssignedIssueList,
  WorkBriefApiRequest,
} from "./work-briefs.types";

type AssignedIssueListProps = {
  request: WorkBriefApiRequest;
  refreshConnections: () => Promise<void>;
  onSelectIssue: (issueKey: string) => void;
  onOpenDraft: (draftId: string) => void;
};

/**
 * The issues assigned to the signed-in user, so starting a brief no longer
 * requires remembering an issue key.
 *
 * An issue that already has one of the user's drafts opens that draft instead
 * of starting a new one: creating a second draft for the same issue is refused
 * by the server anyway, and the 409 is a worse way to learn it.
 */
export function AssignedIssueList({
  request,
  refreshConnections,
  onSelectIssue,
  onOpenDraft,
}: AssignedIssueListProps) {
  const [list, setList] = useState<JiraAssignedIssueList | null>(null);
  const [rows, setRows] = useState<AssignedIssueRows["rows"]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );

  // `request` is re-created on every parent render, so the read is done
  // through a ref rather than depending on its identity.
  const requestRef = useRef(request);
  const refreshConnectionsRef = useRef(refreshConnections);
  useEffect(() => {
    requestRef.current = request;
    refreshConnectionsRef.current = refreshConnections;
  });

  useEffect(() => {
    let active = true;
    loadAssignedIssueRows(
      requestRef.current,
      refreshConnectionsRef.current,
    )
      .then(({ list: loaded, rows: loadedRows }) => {
        if (!active) return;
        setList(loaded);
        setRows(loadedRows);
        setState("ready");
      })
      .catch(() => {
        if (!active) return;
        setState("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  if (state === "loading") {
    return (
      <section className="work-brief-assigned ds-card" aria-busy="true">
        <h2>내 담당 이슈</h2>
        <p className="work-brief-draft-list-empty">담당 이슈를 불러오는 중입니다.</p>
      </section>
    );
  }

  if (state === "unavailable" || !list) {
    return (
      <section className="work-brief-assigned ds-card">
        <h2>내 담당 이슈</h2>
        <p className="work-brief-draft-list-empty">
          담당 이슈를 불러오지 못했습니다. 이슈 키를 직접 입력해 시작할 수
          있습니다.
        </p>
      </section>
    );
  }

  const emptyText = assignedIssueEmptyText(list);

  return (
    <section className="work-brief-assigned ds-card">
      <h2>내 담당 이슈</h2>
      {emptyText ? (
        <p className="work-brief-draft-list-empty">{emptyText}</p>
      ) : (
        <ul className="work-brief-assigned-items">
          {rows.map(({ issue, draftId }) => (
            <li key={issue.issueKey}>
              <div className="work-brief-assigned-item">
                <span className="work-brief-draft-list-key">
                  {issue.issueKey}
                </span>
                <span className="work-brief-draft-list-title">
                  {issue.title}
                </span>
              </div>
              {draftId ? (
                <Badge tone="info">{ASSIGNED_ISSUE_DRAFT_BADGE}</Badge>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  draftId ? onOpenDraft(draftId) : onSelectIssue(issue.issueKey)
                }
              >
                {draftId ? "초안 열기" : "근거 선택"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
