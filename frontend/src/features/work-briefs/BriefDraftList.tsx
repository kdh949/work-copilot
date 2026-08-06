import { useEffect, useRef, useState } from "react";
import { IconTrash } from "@tabler/icons-react";
import { Alert, Badge, Button } from "../../design-system/components";
import {
  DELETE_CONFIRM_NOTE,
  deleteRejectionReason,
  draftEvidenceCountText,
  draftPublicationLabel,
  draftStatusLabel,
  draftTitleText,
  type DeleteRejection,
} from "./brief-draft-list-copy";
import type {
  BriefDraftListView,
  BriefDraftSummary,
  WorkBriefApiRequest,
} from "./work-briefs.types";

type HttpError = Error & { status?: number; code?: string };

type BriefDraftListProps = {
  request: WorkBriefApiRequest;
  onOpen: (draftId: string) => void;
};

const formatUpdatedAt = (value: string): string => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString("ko-KR");
};

/**
 * Drafts the signed-in user has in progress.
 *
 * This list is what makes work survive a closed browser: before it existed the
 * draft id lived only in page state, so a reload orphaned the draft and left
 * its Jira issue permanently occupied.
 *
 * Visibility is own-drafts-only, matching the server. A colleague's draft on
 * the same issue is not shown and surfaces only as the 409 on create.
 */
export function BriefDraftList({
  request,
  onOpen,
}: BriefDraftListProps) {
  const [items, setItems] = useState<BriefDraftSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rejection, setRejection] = useState<
    (DeleteRejection & { draftId: string }) | null
  >(null);

  // `request` is re-created on every parent render, so the first page is read
  // through a ref rather than depending on its identity.
  const requestRef = useRef(request);
  useEffect(() => {
    requestRef.current = request;
  });

  useEffect(() => {
    let isCurrent = true;
    void requestRef
      .current<BriefDraftListView>("/brief-drafts")
      .then(
        (view) => {
          if (!isCurrent) return;
          setItems(view.items);
          setNextCursor(view.nextCursor);
          setState("ready");
        },
        // A list that cannot be read must not render as "no drafts". That
        // reads as "nothing in progress" and invites a second draft for an
        // issue that already has one.
        () => {
          if (isCurrent) setState("unavailable");
        },
      );
    return () => {
      isCurrent = false;
    };
  }, []);

  async function loadMore() {
    if (!nextCursor) return;
    try {
      setIsLoadingMore(true);
      const view = await request<BriefDraftListView>(
        `/brief-drafts?cursor=${encodeURIComponent(nextCursor)}`,
      );
      setItems((current) => [...current, ...view.items]);
      setNextCursor(view.nextCursor);
    } catch {
      setState("unavailable");
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function deleteDraft(draftId: string) {
    try {
      setDeletingId(draftId);
      setRejection(null);
      await request<void>(`/brief-drafts/${draftId}`, { method: "DELETE" });
      setItems((current) => current.filter((item) => item.id !== draftId));
      setConfirmingId(null);
    } catch (error) {
      setRejection({
        ...deleteRejectionReason((error as HttpError).code),
        draftId,
      });
      setConfirmingId(null);
    } finally {
      setDeletingId(null);
    }
  }

  if (state === "loading") {
    return (
      <section className="work-brief-draft-list ds-card" aria-busy="true">
        <h2>진행 중인 브리프</h2>
        <p className="work-brief-draft-list-empty">초안을 불러오는 중입니다.</p>
      </section>
    );
  }

  if (state === "unavailable") {
    return (
      <section className="work-brief-draft-list ds-card">
        <h2>진행 중인 브리프</h2>
        <Alert tone="warning">
          초안 목록을 불러오지 못했습니다. 목록이 비어 있다는 뜻은 아니므로,
          같은 이슈로 새 브리프를 만들기 전에 다시 시도하세요.
        </Alert>
      </section>
    );
  }

  return (
    <section className="work-brief-draft-list ds-card">
      <header className="work-brief-draft-list-header">
        <h2>진행 중인 브리프</h2>
        <span>{items.length}건</span>
      </header>

      {rejection ? (
        <Alert tone="warning" role="alert">
          {rejection.text}
          {rejection.offersResume ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onOpen(rejection.draftId)}
            >
              초안 열기
            </Button>
          ) : null}
        </Alert>
      ) : null}

      {items.length === 0 ? (
        <p className="work-brief-draft-list-empty">
          진행 중인 초안이 없습니다. 아래에서 Jira 이슈를 불러와 시작하세요.
        </p>
      ) : (
        <ul className="work-brief-draft-list-items">
          {items.map((item) => {
            const publicationLabel = draftPublicationLabel(item.publication);

            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="work-brief-draft-list-open"
                  onClick={() => onOpen(item.id)}
                >
                  <span className="work-brief-draft-list-key">
                    {item.sourceJiraKey}
                  </span>
                  <span className="work-brief-draft-list-title">
                    {draftTitleText(item)}
                  </span>
                  <span className="work-brief-draft-list-meta">
                    {draftEvidenceCountText(item)} ·{" "}
                    {formatUpdatedAt(item.updatedAt)}
                  </span>
                </button>

                <div className="work-brief-draft-list-badges">
                  <Badge
                    tone={item.status === "draft" ? "neutral" : "warning"}
                  >
                    {draftStatusLabel[item.status]}
                  </Badge>
                  {publicationLabel ? (
                    <Badge tone="info">{publicationLabel}</Badge>
                  ) : null}
                </div>

                {confirmingId === item.id ? (
                  <div
                    className="work-brief-draft-list-confirm"
                    role="group"
                    aria-label={`${item.sourceJiraKey} 초안 삭제 확인`}
                  >
                    <p>
                      <strong>{item.sourceJiraKey}</strong> 초안을
                      삭제할까요?
                    </p>
                    <p className="work-brief-draft-list-confirm-note">
                      {DELETE_CONFIRM_NOTE}
                    </p>
                    <div className="button-row">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setConfirmingId(null)}
                      >
                        취소
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={deletingId === item.id}
                        onClick={() => void deleteDraft(item.id)}
                      >
                        {deletingId === item.id ? "삭제 중" : "삭제"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    leadingIcon={<IconTrash size={15} />}
                    onClick={() => {
                      setRejection(null);
                      setConfirmingId(item.id);
                    }}
                  >
                    삭제
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {nextCursor ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isLoadingMore}
          onClick={() => void loadMore()}
        >
          {isLoadingMore ? "불러오는 중" : "더 보기"}
        </Button>
      ) : null}
    </section>
  );
}
