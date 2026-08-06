import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconAdjustmentsHorizontal,
  IconBrandJira,
  IconRefresh,
  IconSearch,
  IconStack2,
  IconX,
} from "@tabler/icons-react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  IconButton,
  StatusIndicator,
  TextArea,
  TextInput,
} from "../../design-system/components";
import type {
  BriefPublication,
  BriefContent,
  BriefDraft,
  ChildTask,
  EvidenceCitation,
  EvidenceCollection,
  ReadinessAssessment,
  PublicationPhase,
  PublicationPreview,
  PublicationPreviews,
  WorkBriefApiRequest,
  WorkEvidence,
} from "./work-briefs.types";
import { BriefDraftList } from "./BriefDraftList";
import { createDraftFailureMessage } from "./brief-draft-error-copy";
import {
  canRegenerateDraft,
  emptySectionNotice,
  excludedEvidenceReason,
  regenerateFailureMessage,
  REGENERATE_CONFIRM_NOTE,
  REGENERATE_UNDO_NOTE,
} from "./brief-regeneration-copy";
import { loadDraftRoute } from "./draft-route-loader";
import { PublicationPanel, PublicationProgress } from "./PublicationPanel";
import {
  canRunReadinessAssessment,
  canUsePublication,
  isReadinessAssessmentCurrent,
  publicationForCurrentDraft,
  withConnectionStatusRefresh,
} from "./work-brief-guards";
import {
  connectionTone,
  providerLabel,
  statusCopy,
  type ConnectionStatus,
  type IntegrationConnection,
  type IntegrationProvider,
} from "../integrations/connection-status";
import "./work-briefs.css";

type WorkBriefsPageProps = {
  request: WorkBriefApiRequest;
  onOpenIntegrations?: () => void;
  initialIssueKey?: string;
  initialEvidence?: WorkEvidence[];
  /**
   * The draft in the URL. Present means the editing stage, absent means the
   * list plus evidence selection. Only one stage is mounted at a time.
   */
  draftId?: string;
  /**
   * Move to a draft's own URL, so a reload comes back to the same work.
   * `replace` is for the draft that was just created: its selection screen is
   * not somewhere the back button should return to.
   */
  onOpenDraft?: (draftId: string, options?: { replace?: boolean }) => void;
  /** The draft in the URL is gone or not ours; go back to the list. */
  onDraftUnavailable?: (reason: string) => void;
};

type HttpError = Error & { status?: number; code?: string };

/** The open "다시 생성" dialog: what will be sent once the user confirms. */
type RegeneratePrompt = {
  instruction: string;
  selectedEvidenceIds: string[];
};

// Outcomes are toned so a completed action never renders as a warning.
// `warning` asks the user to do something first; `danger` reports a failure.
export type Notice = {
  tone: "success" | "warning" | "danger";
  text: string;
} | null;

type ConnectionSnapshot =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "ready"; byProvider: Record<IntegrationProvider, ConnectionStatus> };

const PROVIDER_ORDER: IntegrationProvider[] = ["jira", "confluence"];

function toConnectionSnapshot(
  loaded: IntegrationConnection[],
): ConnectionSnapshot {
  if (!Array.isArray(loaded)) return { state: "unavailable" };
  const statusOf = (provider: IntegrationProvider): ConnectionStatus =>
    loaded.find((connection) => connection.provider === provider)?.status ??
    "authorization_required";
  return {
    state: "ready",
    byProvider: { jira: statusOf("jira"), confluence: statusOf("confluence") },
  };
}

function connectionsNeedingAction(
  snapshot: ConnectionSnapshot,
): IntegrationProvider[] {
  if (snapshot.state !== "ready") return [];
  return PROVIDER_ORDER.filter(
    (provider) => snapshot.byProvider[provider] !== "connected",
  );
}

const blockReason = (code: BriefDraft["blockers"][number]["code"]) =>
  code === "ACCESS_CHANGED"
    ? "원본 접근 권한이 바뀌었습니다. 관련 근거와 브리프는 다시 검토해야 합니다."
    : "근거 버전이 변경되었습니다. 최신 원본을 검토한 뒤 저장하세요.";

const emptyCitation = (evidenceIds: string[]): EvidenceCitation => ({
  text: "새 항목",
  evidenceIds,
  userAuthored: true,
});

const emptyPublicationApprovals = (): Record<PublicationPhase, boolean> => ({
  confluence: false,
  jira: false,
  child_tasks: false,
});

const mergeEvidence = (...groups: WorkEvidence[][]): WorkEvidence[] => {
  const merged = new Map<string, WorkEvidence>();
  for (const item of groups.flat()) {
    const current = merged.get(item.id);
    merged.set(item.id, {
      ...current,
      ...item,
      recommendationReasons:
        item.recommendationReasons ?? current?.recommendationReasons,
    });
  }
  return [...merged.values()];
};

export function WorkBriefsPage({
  request,
  onOpenIntegrations,
  initialIssueKey = "",
  initialEvidence = [],
  draftId,
  onOpenDraft,
  onDraftUnavailable,
}: WorkBriefsPageProps) {
  const [issueKey, setIssueKey] = useState(initialIssueKey);
  const [instruction, setInstruction] = useState(
    "선택한 근거만 사용해 실행 브리프를 작성하세요.",
  );
  const [jiraEvidence, setJiraEvidence] = useState<WorkEvidence[]>(
    initialEvidence.filter((item) => item.provider === "jira"),
  );
  const [confluenceEvidence, setConfluenceEvidence] = useState<
    WorkEvidence[]
  >(initialEvidence.filter((item) => item.provider === "confluence"));
  const [confluenceSpaceKey, setConfluenceSpaceKey] = useState("");
  const [confluenceQuery, setConfluenceQuery] = useState("");
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[]>(
    initialEvidence.filter((item) => item.aiStatus !== "excluded").map((item) => item.id),
  );
  const [query, setQuery] = useState("");
  const [documentType, setDocumentType] = useState("all");
  const [showJira, setShowJira] = useState(true);
  const [showConfluence, setShowConfluence] = useState(true);
  const [showSourceOptions, setShowSourceOptions] = useState(false);
  const [draft, setDraft] = useState<BriefDraft | null>(null);
  const [editingContent, setEditingContent] = useState<BriefContent | null>(
    null,
  );
  const [isLoadingEvidence, setIsLoadingEvidence] = useState(false);
  const [isLoadingConfluenceEvidence, setIsLoadingConfluenceEvidence] =
    useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regeneratePrompt, setRegeneratePrompt] =
    useState<RegeneratePrompt | null>(null);
  // The content as it stood right before regeneration, kept for a single undo
  // (R10). A draft version history table is out of scope, so this lives in the
  // client only and is dropped as soon as the draft is reloaded or saved.
  const [undoContent, setUndoContent] = useState<BriefContent | null>(null);
  const [message, setMessage] = useState<Notice>(null);
  const [conflict, setConflict] = useState(false);
  const [readiness, setReadiness] = useState<ReadinessAssessment | null>(null);
  // Set when the draft is edited but not yet re-assessed. Without it the panel
  // keeps advertising "게시 가능" for content the server has never checked.
  const [readinessStale, setReadinessStale] = useState(false);
  const [isAssessingReadiness, setIsAssessingReadiness] = useState(false);
  const [publication, setPublication] = useState<BriefPublication | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isLoadingPublicationPreview, setIsLoadingPublicationPreview] = useState(false);
  const [publicationPreviews, setPublicationPreviews] = useState<PublicationPreviews>({});
  const [publicationApprovals, setPublicationApprovals] = useState<Record<PublicationPhase, boolean>>(
    emptyPublicationApprovals,
  );
  const inFlightCommandKeyRef = useRef<Partial<Record<PublicationPhase, string>>>({});
  const editingRevisionRef = useRef(0);
  const publicationRequestRevisionRef = useRef(0);
  const draftRouteRequestRevisionRef = useRef(0);
  const connectionRequestRevisionRef = useRef(0);
  const [connections, setConnections] = useState<ConnectionSnapshot>({
    state: "loading",
  });

  const clearMessage = () => setMessage(null);
  const notifySuccess = (text: string) => setMessage({ tone: "success", text });
  const notifyWarning = (text: string) => setMessage({ tone: "warning", text });
  const notifyFailure = (text: string) => setMessage({ tone: "danger", text });

  // `request` is re-created on every parent render, so the connection lookup
  // reads it through a ref instead of depending on its identity.
  const requestRef = useRef(request);
  const onDraftUnavailableRef = useRef(onDraftUnavailable);
  useEffect(() => {
    requestRef.current = request;
    onDraftUnavailableRef.current = onDraftUnavailable;
  });

  const loadConnections = useCallback(
    () => {
      const requestRevision = ++connectionRequestRevisionRef.current;
      return requestRef.current<IntegrationConnection[]>("/integrations").then(
        (loaded) => {
          if (requestRevision === connectionRequestRevisionRef.current) {
            setConnections(toConnectionSnapshot(loaded));
          }
        },
        // An unverified connection is reported as unknown. This screen must
        // never fall back to a healthy-looking state, because a stale
        // "connected" badge is exactly what hides an expired token.
        () => {
          if (requestRevision === connectionRequestRevisionRef.current) {
            setConnections({ state: "unavailable" });
          }
        },
      );
    },
    [],
  );

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  // Each setup gets its own revision. React StrictMode deliberately executes
  // setup → cleanup → setup, so a one-shot ref would discard the second setup
  // and leave the first response unable to update state. The current revision
  // is also what prevents a prior URL from winning after navigation.
  useEffect(() => {
    const requestRevision = ++draftRouteRequestRevisionRef.current;
    // A publication request started by a previous local update must not apply
    // after the route has changed.
    publicationRequestRevisionRef.current += 1;

    if (!draftId) {
      clearDraftRouteState();
      return;
    }

    clearDraftRouteState();

    void loadDraftRoute(requestRef.current, draftId)
      .then((loaded) => {
        if (requestRevision !== draftRouteRequestRevisionRef.current) return;
        initializeDraftState(loaded.draft);
        if (loaded.publication) {
          setPublication(loaded.publication);
          resetNeedsReviewState(loaded.publication);
        }
        if (loaded.readiness) {
          setReadiness(loaded.readiness);
          setReadinessStale(false);
        }
      })
      .catch((error: unknown) => {
        if (requestRevision !== draftRouteRequestRevisionRef.current) return;
        const status = (error as HttpError).status;
        onDraftUnavailableRef.current?.(
          status === 404 || status === 403
            ? "초안을 찾을 수 없습니다. 이미 삭제되었거나 접근 권한이 없습니다."
            : "초안을 불러오지 못했습니다. 잠시 후 다시 시도하세요.",
        );
      });
  }, [draftId]);

  const evidence = useMemo(
    () => [...jiraEvidence, ...confluenceEvidence],
    [jiraEvidence, confluenceEvidence],
  );

  const selectedEvidence = useMemo(
    () => evidence.filter((item) => selectedEvidenceIds.includes(item.id)),
    [evidence, selectedEvidenceIds],
  );

  const filteredEvidence = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko");
    return evidence.filter((item) => {
      if (item.provider === "jira" && !showJira) return false;
      if (item.provider === "confluence" && !showConfluence) return false;
      if (documentType !== "all" && item.provider !== documentType) return false;
      return normalizedQuery.length === 0 ||
        `${item.title} ${item.sourceId} ${item.location ?? ""}`.toLocaleLowerCase("ko").includes(normalizedQuery);
    });
  }, [documentType, evidence, query, showConfluence, showJira]);

  const jiraSelectedCount = selectedEvidence.filter((item) => item.provider === "jira").length;
  const confluenceSelectedCount = selectedEvidence.length - jiraSelectedCount;

  const connectionWarnings = useMemo(
    () =>
      connectionsNeedingAction(connections).map((provider) => ({
        provider,
        detail:
          connections.state === "ready"
            ? statusCopy[connections.byProvider[provider]].detail
            : "",
      })),
    [connections],
  );

  function initializeDraftState(nextDraft: BriefDraft) {
    editingRevisionRef.current += 1;
    setDraft(nextDraft);
    setEditingContent(nextDraft.content);
    setConflict(false);
    // The undo buffer belongs to one regeneration of one loaded draft.
    setUndoContent(null);
    // Content changed, so the previous assessment and every previewHash-bound
    // approval are void. That reset is deliberate; only the *visibility* of
    // already-executed steps is restored elsewhere.
    setReadiness(null);
    setReadinessStale(false);
    setPublication(null);
    setPublicationPreviews({});
    setPublicationApprovals(emptyPublicationApprovals());
    inFlightCommandKeyRef.current = {};
  }

  function clearDraftRouteState() {
    editingRevisionRef.current += 1;
    setDraft(null);
    setEditingContent(null);
    setConflict(false);
    setUndoContent(null);
    setRegeneratePrompt(null);
    setReadiness(null);
    setReadinessStale(false);
    setPublication(null);
    setPublicationPreviews({});
    setPublicationApprovals(emptyPublicationApprovals());
    inFlightCommandKeyRef.current = {};
  }

  function applyDraft(nextDraft: BriefDraft) {
    const publicationRequestRevision = ++publicationRequestRevisionRef.current;
    initializeDraftState(nextDraft);
    void loadPublication(nextDraft.id, publicationRequestRevision);
  }

  async function collectEvidence() {
    const normalizedKey = issueKey.trim().toUpperCase();
    if (!normalizedKey) {
      notifyWarning("Jira 이슈 키를 입력하세요.");
      return;
    }

    try {
      setIsLoadingEvidence(true);
      clearMessage();
      const result = await withConnectionStatusRefresh(
        () =>
          request<EvidenceCollection>(
            `/work-items/jira/${encodeURIComponent(normalizedKey)}/context`,
          ),
        loadConnections,
      );
      if (result.accessStatus !== "accessible") {
        setJiraEvidence([]);
        setConfluenceEvidence([]);
        setSelectedEvidenceIds([]);
        notifyFailure("현재 사용자 권한으로 이슈 근거를 읽을 수 없습니다.");
        return;
      }
      setIssueKey(normalizedKey);
      const recommendations = result.recommendations ?? [];
      setJiraEvidence(
        mergeEvidence(
          result.evidence,
          recommendations.filter((item) => item.provider === "jira"),
        ),
      );
      setConfluenceEvidence(
        recommendations.filter((item) => item.provider === "confluence"),
      );
      setSelectedEvidenceIds(result.evidence.map((item) => item.id));
      if (result.recommendationAccessStatus === "access_limited") {
        notifyFailure(
          "Jira 근거를 불러왔습니다. Confluence 자동 추천은 현재 권한으로 확인할 수 없습니다.",
        );
      }
    } catch {
      notifyFailure(
        "이슈 근거를 불러오지 못했습니다. 연결 상태와 권한을 확인하세요.",
      );
    } finally {
      setIsLoadingEvidence(false);
    }
  }

  async function collectConfluenceEvidence() {
    const spaceKey = confluenceSpaceKey.trim().toUpperCase();
    const query = confluenceQuery.trim();

    if (!issueKey || jiraEvidence.length === 0) {
      notifyWarning("먼저 Jira 이슈 근거를 조회하세요.");
      return;
    }
    if (!spaceKey || !query) {
      notifyWarning("Confluence space 키와 검색어를 입력하세요.");
      return;
    }

    try {
      setIsLoadingConfluenceEvidence(true);
      clearMessage();
      const result = await withConnectionStatusRefresh(
        () =>
          request<EvidenceCollection>(
            `/work-items/confluence/spaces/${encodeURIComponent(spaceKey)}/search?q=${encodeURIComponent(query)}`,
          ),
        loadConnections,
      );
      if (result.accessStatus !== "accessible") {
        setConfluenceEvidence([]);
        setSelectedEvidenceIds((current) =>
          current.filter((id) => !id.startsWith("confluence:")),
        );
        notifyFailure("현재 사용자 권한으로 Confluence 근거를 읽을 수 없습니다.");
        return;
      }

      setConfluenceEvidence((current) => mergeEvidence(current, result.evidence));
      setSelectedEvidenceIds((current) =>
        Array.from(new Set([...current, ...result.evidence.map((item) => item.id)])),
      );
    } catch {
      notifyFailure(
        "Confluence 근거를 불러오지 못했습니다. 연결 상태와 허용 space를 확인하세요.",
      );
    } finally {
      setIsLoadingConfluenceEvidence(false);
    }
  }

  function toggleEvidence(evidenceId: string) {
    setSelectedEvidenceIds((current) =>
      current.includes(evidenceId)
        ? current.filter((id) => id !== evidenceId)
        : [...current, evidenceId],
    );
  }

  async function createDraft() {
    if (selectedEvidenceIds.length === 0) {
      notifyWarning("브리프에 포함할 근거를 하나 이상 선택하세요.");
      return;
    }

    try {
      setIsSaving(true);
      clearMessage();
      const created = await withConnectionStatusRefresh(
        () =>
          request<BriefDraft>("/brief-drafts", {
            method: "POST",
            body: JSON.stringify({
              sourceJiraKey: issueKey,
              selectedEvidenceIds,
              instruction,
            }),
          }),
        loadConnections,
      );
      // The draft now has a URL of its own. `replace` keeps the back button
      // pointing at the list rather than at a selection screen whose draft
      // already exists.
      applyDraft(created);
      onOpenDraft?.(created.id, { replace: true });
    } catch (error) {
      notifyFailure(createDraftFailureMessage(error as HttpError));
    } finally {
      setIsSaving(false);
    }
  }

  async function saveDraft() {
    if (!draft || !editingContent) return;

    try {
      setIsSaving(true);
      clearMessage();
      applyDraft(
        await request<BriefDraft>(`/brief-drafts/${draft.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            optimisticVersion: draft.optimisticVersion,
            content: editingContent,
          }),
        }),
      );
      notifySuccess(
        "초안을 저장했습니다. 내용이 바뀌었으므로 준비성 점검과 게시 승인을 다시 진행하세요.",
      );
    } catch (error) {
      if ((error as HttpError).status === 409) {
        setConflict(true);
        notifyFailure(
          "다른 탭에서 먼저 저장했습니다. 최신 초안을 불러와 다시 검토하세요.",
        );
      } else {
        notifyFailure(
          "저장하지 못했습니다. 모든 항목에 선택한 근거를 연결했는지 확인하세요.",
        );
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function refreshDraft() {
    if (!draft) return;

    try {
      setIsSaving(true);
      clearMessage();
      applyDraft(
        await withConnectionStatusRefresh(
          () =>
            request<BriefDraft>(`/brief-drafts/${draft.id}/refresh`, {
              method: "POST",
              body: JSON.stringify({ optimisticVersion: draft.optimisticVersion }),
            }),
          loadConnections,
        ),
      );
    } catch (error) {
      if ((error as HttpError).status === 409) {
        setConflict(true);
        notifyFailure(
          "초안이 다른 탭에서 변경되었습니다. 최신 버전을 불러오세요.",
        );
      } else {
        notifyFailure("근거를 새로 고치지 못했습니다.");
      }
    } finally {
      setIsSaving(false);
    }
  }

  function openRegeneratePrompt() {
    if (!draft) return;
    setRegeneratePrompt({
      instruction,
      // Excluded evidence is unchecked by default: the model already said it
      // could not use it, and the user can put it back deliberately.
      selectedEvidenceIds: draft.evidence
        .filter((item) => item.aiStatus !== "excluded")
        .map((item) => item.id),
    });
  }

  async function regenerateDraft(prompt: RegeneratePrompt) {
    if (!draft) return;
    if (prompt.selectedEvidenceIds.length === 0) {
      notifyWarning("근거를 하나 이상 선택하세요.");
      return;
    }

    const previousContent = editingContent;
    try {
      setIsRegenerating(true);
      clearMessage();
      const next = await withConnectionStatusRefresh(
        () =>
          request<BriefDraft>(`/brief-drafts/${draft.id}/regenerate`, {
            method: "POST",
            body: JSON.stringify({
              optimisticVersion: draft.optimisticVersion,
              instruction: prompt.instruction,
              selectedEvidenceIds: prompt.selectedEvidenceIds,
            }),
          }),
        loadConnections,
      );
      setRegeneratePrompt(null);
      applyDraft(next);
      setUndoContent(previousContent);
      notifySuccess(
        "브리프를 다시 생성했습니다. 저장 전이라면 되돌릴 수 있습니다.",
      );
    } catch (error) {
      const failure = error as HttpError;
      if (failure.status === 409) {
        // The server marks a moved draft for review in the same response, so
        // the local copy is already out of date.
        setConflict(true);
        void reloadDraft({ silent: true });
      }
      notifyFailure(regenerateFailureMessage(failure));
    } finally {
      setIsRegenerating(false);
    }
  }

  /** The single undo. Restores the editor only; saving is still explicit. */
  function undoRegeneration() {
    if (!undoContent) return;
    editingRevisionRef.current += 1;
    setEditingContent(undoContent);
    setUndoContent(null);
    setReadinessStale(true);
    notifyWarning(REGENERATE_UNDO_NOTE);
  }

  async function reloadDraft(options: { silent?: boolean } = {}) {
    if (!draft) return;
    try {
      applyDraft(await request<BriefDraft>(`/brief-drafts/${draft.id}`));
      if (!options.silent) {
        notifySuccess("최신 초안을 불러왔습니다. 변경 내용을 다시 검토하세요.");
      }
    } catch {
      if (!options.silent) {
        notifyFailure("최신 초안을 불러오지 못했습니다.");
      }
    }
  }

  async function assessReadiness() {
    if (!draft) return;
    if (!canRunReadinessAssessment(readinessStale)) {
      notifyWarning("편집한 내용을 저장한 뒤 준비성 점검을 다시 실행하세요.");
      return;
    }

    const requestedEditRevision = editingRevisionRef.current;

    try {
      setIsAssessingReadiness(true);
      clearMessage();
      const nextReadiness = await withConnectionStatusRefresh(
        () =>
          request<ReadinessAssessment>(
            `/brief-drafts/${draft.id}/readiness`,
          ),
        loadConnections,
      );
      if (
        !isReadinessAssessmentCurrent(
          requestedEditRevision,
          editingRevisionRef.current,
        )
      ) {
        return;
      }
      setReadiness(nextReadiness);
      setReadinessStale(false);
    } catch {
      notifyFailure(
        "준비성 점검을 완료하지 못했습니다. 연결 상태와 권한을 확인하세요.",
      );
    } finally {
      setIsAssessingReadiness(false);
    }
  }

  async function loadPublication(
    draftId: string,
    requestRevision: number,
  ) {
    try {
      const nextPublication = await request<BriefPublication>(
        `/brief-drafts/${draftId}/publication`,
      );
      if (requestRevision !== publicationRequestRevisionRef.current) return;
      setPublication(nextPublication);
      resetNeedsReviewState(nextPublication);
    } catch {
      if (requestRevision !== publicationRequestRevisionRef.current) return;
      setPublication(null);
    }
  }

  function resetNeedsReviewState(nextPublication: BriefPublication) {
    const reviewPhases = new Set(
      nextPublication.steps
        .filter((step) => step.status === "NEEDS_REVIEW")
        .map((step) => step.phase),
    );
    if (reviewPhases.size === 0) return;
    setPublicationPreviews((current) => {
      const next = { ...current };
      for (const phase of reviewPhases) delete next[phase];
      return next;
    });
    setPublicationApprovals((current) => {
      const next = { ...current };
      for (const phase of reviewPhases) next[phase] = false;
      return next;
    });
  }

  async function preparePublicationPhase(phase: PublicationPhase) {
    if (!draft || !canUsePublication(draft, readiness, readinessStale)) {
      notifyWarning(
        readinessStale
          ? "편집한 내용을 저장하고 준비성 점검을 다시 실행한 뒤 미리보기를 열 수 있습니다."
          : "준비성 점검을 통과한 초안만 게시 미리보기를 열 수 있습니다.",
      );
      return;
    }
    const currentPublication = publicationForCurrentDraft(publication, draft);
    if (currentPublication?.status === "PUBLISHING") {
      notifyWarning("다른 요청이 게시를 처리 중입니다. 완료 상태가 갱신될 때까지 기다리세요.");
      return;
    }
    if (phase !== "confluence" && !currentPublication) {
      notifyWarning("Confluence 게시가 완료된 후 다음 단계 미리보기를 열 수 있습니다.");
      return;
    }

    const path = currentPublication
      ? phase === "jira"
        ? `/brief-drafts/${draft.id}/publication/${currentPublication.id}/jira-preview`
        : phase === "child_tasks"
          ? `/brief-drafts/${draft.id}/publication/${currentPublication.id}/child-tasks-preview`
          : `/brief-drafts/${draft.id}/publication-preview`
      : `/brief-drafts/${draft.id}/publication-preview`;

    try {
      setIsLoadingPublicationPreview(true);
      clearMessage();
      const preview = await withConnectionStatusRefresh(
        () => request<PublicationPreview>(path),
        loadConnections,
      );
      setPublicationPreviews((current) => ({ ...current, [phase]: preview }));
      setPublicationApprovals((current) => ({ ...current, [phase]: false }));
    } catch (error) {
      if ((error as HttpError).status === 409) {
        setConflict(true);
        notifyFailure("미리보기 대상 또는 초안 버전이 바뀌었습니다. 최신 초안을 다시 검토하세요.");
      } else {
        notifyFailure("게시 미리보기를 준비하지 못했습니다. 연결 권한과 준비성 상태를 확인하세요.");
      }
    } finally {
      setIsLoadingPublicationPreview(false);
    }
  }

  async function executePublicationPhase(phase: PublicationPhase) {
    if (!draft || !canUsePublication(draft, readiness, readinessStale)) {
      notifyWarning(
        readinessStale
          ? "편집한 내용을 저장하고 준비성 점검을 다시 실행한 뒤 게시할 수 있습니다."
          : "준비성 점검을 통과한 초안만 게시할 수 있습니다.",
      );
      return;
    }
    const currentPublication = publicationForCurrentDraft(publication, draft);
    if (currentPublication?.status === "PUBLISHING") {
      notifyWarning("다른 요청이 게시를 처리 중입니다. 현재 상태가 갱신될 때까지 기다리세요.");
      return;
    }
    if (phase !== "confluence" && !currentPublication) {
      notifyWarning("Confluence 게시가 완료된 후 다음 단계를 실행할 수 있습니다.");
      return;
    }
    const preview = publicationPreviews[phase];
    if (!preview) {
      notifyWarning("승인 전에 현재 단계의 미리보기를 열어야 합니다.");
      return;
    }
    if (!publicationApprovals[phase]) {
      notifyWarning("현재 단계의 미리보기를 검토한 뒤 승인하세요.");
      return;
    }

    // This key deduplicates only the in-flight HTTP command. Durable retry
    // identity is the server-side publication + phase, so a refreshed page
    // can safely issue a new command key for an incomplete step.
    const idempotencyKey =
      inFlightCommandKeyRef.current[phase] ?? createIdempotencyKey();
    inFlightCommandKeyRef.current[phase] = idempotencyKey;
    const shouldRetry = Boolean(
      currentPublication?.steps.some((step) => step.phase === phase),
    );
    const base = {
      draftVersion: draft.optimisticVersion,
      approved: true,
      previewHash: preview.previewHash,
      approvalRevision: preview.approvalRevision,
    };
    const path = shouldRetry && currentPublication
      ? `/brief-drafts/${draft.id}/publication/${currentPublication.id}/retry`
      : phase === "confluence"
        ? `/brief-drafts/${draft.id}/publish`
        : phase === "jira"
          ? `/brief-drafts/${draft.id}/publication/${currentPublication?.id}/jira`
          : `/brief-drafts/${draft.id}/publication/${currentPublication?.id}/child-tasks`;
    const body = shouldRetry ? { ...base, phase } : base;

    try {
      setIsPublishing(true);
      clearMessage();
      const nextPublication = await withConnectionStatusRefresh(
        () =>
          request<BriefPublication>(path, {
            method: "POST",
            headers: { "Idempotency-Key": idempotencyKey },
            body: JSON.stringify(body),
          }),
        loadConnections,
      );
      publicationRequestRevisionRef.current += 1;
      setPublication(nextPublication);
      setPublicationApprovals((current) => ({ ...current, [phase]: false }));
      if (nextPublication.status === "NEEDS_REVIEW") {
        setPublicationPreviews((current) => ({
          ...current,
          [phase]: undefined,
        }));
        resetNeedsReviewState(nextPublication);
      }
      if (
        nextPublication.status === "PARTIALLY_PUBLISHED" ||
        nextPublication.status === "NEEDS_REVIEW"
      ) {
        notifyWarning(
          `${publicationPhaseLabel(phase)} 단계가 일부 완료되었습니다. 미리보기를 다시 검토한 뒤 복구하세요.`,
        );
      } else {
        notifySuccess(
          nextPublication.executionMode === "real"
            ? `${publicationPhaseLabel(phase)} 단계를 외부 도구에 반영했습니다.`
            : `${publicationPhaseLabel(phase)} 단계를 mock 모드로 기록했습니다.`,
        );
      }
    } catch (error) {
      if ((error as HttpError).status === 409) {
        setConflict(true);
        notifyFailure("현재 승인으로는 게시할 수 없습니다. 해당 단계의 미리보기를 다시 열고 새로 승인하세요.");
      } else {
        notifyFailure(`${publicationPhaseLabel(phase)} 반영을 확인하지 못했습니다. 중복 생성을 막기 위해 미리보기를 다시 열어 상태를 확인한 뒤 재시도하세요.`);
      }
    } finally {
      delete inFlightCommandKeyRef.current[phase];
      setIsPublishing(false);
    }
  }

  function updatePublicationApproval(phase: PublicationPhase, approved: boolean) {
    setPublicationApprovals((current) => ({ ...current, [phase]: approved }));
  }

  function updateContent(updater: (current: BriefContent) => BriefContent) {
    editingRevisionRef.current += 1;
    setEditingContent((current) => (current ? updater(current) : current));
    setReadinessStale(true);
  }

  // A draft URL whose draft has not arrived yet is neither stage.
  const isOpeningDraft = Boolean(draftId) && draft?.id !== draftId;
  const editingEvidence = draft?.evidence ?? selectedEvidence;
  const currentPublication = publicationForCurrentDraft(publication, draft);
  const hasHistoricalPublication = Boolean(publication && !currentPublication);

  return (
    <section className="work-brief-page" aria-labelledby="work-brief-title">
      {/* The two stages are mounted separately. `/briefs` is evidence
          selection with the list of drafts already in progress; a draft URL
          is the editor. Keeping both mounted was what made a reload lose the
          draft id in the first place. */}
      {draftId ? null : (
        <>
          <BriefDraftList
            request={request}
            onOpen={(openedDraftId) => onOpenDraft?.(openedDraftId)}
          />
          <div className="work-brief-workspace">
            <aside className="work-brief-source-rail" aria-label="근거 범위">
              <div className="work-brief-rail-heading">
                <span className="work-brief-source-icon work-brief-source-icon--jira"><IconBrandJira size={19} /></span>
                <div><strong>Jira 이슈</strong><span>브리프 기준 항목</span></div>
              </div>
              <form className="work-brief-issue-form" onSubmit={(event) => { event.preventDefault(); void collectEvidence(); }}>
                <label htmlFor="brief-issue-key">이슈 키</label>
                <div>
                  <input id="brief-issue-key" value={issueKey} placeholder="예: PROJ-284" onChange={(event) => setIssueKey(event.target.value)} />
                  <Button type="submit" size="sm" disabled={isLoadingEvidence}>{isLoadingEvidence ? "조회 중" : "불러오기"}</Button>
                </div>
              </form>

              <div className="work-brief-rail-divider" />
              <div className="work-brief-source-list-heading"><strong>근거 소스</strong><button type="button" onClick={() => { setShowJira(true); setShowConfluence(true); setDocumentType("all"); setQuery(""); }}>필터 초기화</button></div>
              <div className="work-brief-source-list">
                <Checkbox checked={showJira} onChange={(event) => setShowJira(event.target.checked)} label={<><IconBrandJira size={17} /> Jira</>} description={`${jiraEvidence.length}개 항목`} />
                <Checkbox checked={showConfluence} onChange={(event) => setShowConfluence(event.target.checked)} label={<><IconStack2 size={17} /> Confluence</>} description={`${confluenceEvidence.length}개 문서`} />
              </div>
              <div className="work-brief-rail-note">
                <strong>권한 범위</strong>
                <p>현재 계정으로 열 수 있는 항목만 표시합니다.</p>
              </div>
            </aside>

            <section className="work-brief-main">
              <header className="work-brief-main-header">
                <div>
                  <p className="work-brief-kicker">업무 브리프</p>
                  <h1 id="work-brief-title">근거 선택</h1>
                  <p>{issueKey || "Jira 이슈"}에 사용할 문서와 이슈를 선택하세요.</p>
                </div>
                <Button variant="secondary" size="sm" leadingIcon={<IconRefresh size={16} />} onClick={() => void collectEvidence()} disabled={isLoadingEvidence}>새로 고침</Button>
              </header>

              {message ? (
                <Alert tone={message.tone} className="work-brief-message">
                  {message.text}
                </Alert>
              ) : null}

              <div className="work-brief-filters">
                <label><span>문서 유형</span><select value={documentType} onChange={(event) => setDocumentType(event.target.value)}><option value="all">전체</option><option value="jira">Jira</option><option value="confluence">Confluence</option></select></label>
                <label className="work-brief-search"><span className="sr-only">근거 검색</span><IconSearch size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제목 또는 키 검색" /></label>
                <IconButton label="추가 검색 조건" onClick={() => setShowSourceOptions((current) => !current)} aria-pressed={showSourceOptions}><IconAdjustmentsHorizontal size={18} /></IconButton>
              </div>

              {showSourceOptions ? (
                <section className="work-brief-source-options">
                  <label htmlFor="brief-confluence-space">Confluence space</label>
                  <input id="brief-confluence-space" value={confluenceSpaceKey} placeholder="예: ENG" onChange={(event) => setConfluenceSpaceKey(event.target.value)} />
                  <label htmlFor="brief-confluence-query">검색어</label>
                  <input id="brief-confluence-query" value={confluenceQuery} placeholder="예: 배포 결정" onChange={(event) => setConfluenceQuery(event.target.value)} />
                  <Button type="button" size="sm" onClick={() => void collectConfluenceEvidence()} disabled={isLoadingConfluenceEvidence || isLoadingEvidence}>{isLoadingConfluenceEvidence ? "검색 중" : "문서 검색"}</Button>
                  <label htmlFor="brief-instruction">작성 지시</label>
                  <input id="brief-instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} />
                </section>
              ) : null}

              <div className="work-brief-table-head">
                <Checkbox
                  checked={filteredEvidence.length > 0 && filteredEvidence.every((item) => selectedEvidenceIds.includes(item.id))}
                  onChange={(event) => setSelectedEvidenceIds((current) => event.target.checked ? Array.from(new Set([...current, ...filteredEvidence.map((item) => item.id)])) : current.filter((id) => !filteredEvidence.some((item) => item.id === id)))}
                  label={`${filteredEvidence.length}개 근거`}
                />
              </div>

              {filteredEvidence.length > 0 ? (["jira", "confluence"] as const).map((provider) => {
                const items = filteredEvidence.filter((item) => item.provider === provider);
                return items.length ? <EvidenceWorkspaceGroup key={provider} provider={provider} evidence={items} selectedEvidenceIds={selectedEvidenceIds} onToggle={toggleEvidence} /> : null;
              }) : evidence.length === 0 ? (
                <div className="work-brief-empty">
                  <strong>Jira 이슈 키를 입력하고 불러오기를 누르세요.</strong>
                  <span>예: PROJ-284 · 현재 계정 권한으로 읽을 수 있는 근거만 표시합니다.</span>
                </div>
              ) : (
                <div className="work-brief-empty">
                  <strong>조건에 맞는 근거가 없습니다.</strong>
                  <span>검색어나 소스 필터를 조정하세요.</span>
                </div>
              )}
            </section>

            <aside className="work-brief-selection" aria-label="선택한 근거">
              <header><div><h2>선택한 근거</h2><span>{selectedEvidence.length}개</span></div><button type="button" onClick={() => setSelectedEvidenceIds([])}>전체 해제</button></header>
              <ul className="work-brief-selection-list">
                {selectedEvidence.map((item) => (
                  <li key={item.id}>
                    <span className={`work-brief-source-icon work-brief-source-icon--${item.provider}`}>{item.provider === "jira" ? <IconBrandJira size={16} /> : <IconStack2 size={16} />}</span>
                    <div><strong>{item.title}</strong><span>{item.sourceId} · {item.version}</span></div>
                    <IconButton label={`${item.title} 선택 해제`} onClick={() => toggleEvidence(item.id)}><IconX size={15} /></IconButton>
                  </li>
                ))}
              </ul>
              <section className="work-brief-selection-summary"><h3>소스별 항목</h3><div><span>Jira</span><strong>{jiraSelectedCount}</strong></div><div><span>Confluence</span><strong>{confluenceSelectedCount}</strong></div></section>
              <ConnectionSummary snapshot={connections} onOpenIntegrations={onOpenIntegrations} />
              {connectionWarnings.length > 0 && (
                <Alert tone="warning" className="work-brief-connection-warning">
                  <ul>
                    {connectionWarnings.map((warning) => (
                      <li key={warning.provider}>
                        <strong>{providerLabel[warning.provider]}</strong> {warning.detail}
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}
              <footer><Button variant="secondary" onClick={() => setSelectedEvidenceIds([])}>전체 해제</Button><Button onClick={() => void createDraft()} disabled={isSaving || selectedEvidence.length === 0}>{isSaving ? "생성 중" : "브리프 생성"}</Button></footer>
            </aside>
          </div>
        </>
      )}

      {isOpeningDraft ? (
        <p className="work-brief-draft-list-empty" aria-live="polite">
          초안을 불러오는 중입니다.
        </p>
      ) : null}

      {draftId && draft?.id === draftId && (
        <section className="work-brief-editor ds-card" aria-live="polite">
          {/* The save, readiness and publish controls live at the bottom of the
              page, far from the header banner. Repeating the outcome here keeps
              a failed save in the same viewport as the button that caused it. */}
          {message ? (
            <Alert tone={message.tone} className="work-brief-message">
              {message.text}
            </Alert>
          ) : null}
          <header className="work-brief-draft-header">
            <div>
              <p className="eyebrow">초안 v{draft.optimisticVersion}</p>
              <h2>{draft.sourceJiraKey}</h2>
              <p>근거 기준 버전: {draft.sourceJiraVersion}</p>
            </div>
            <div className="button-row">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={refreshDraft}
                disabled={isSaving || isRegenerating}
              >
                근거 새로 고침
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={openRegeneratePrompt}
                disabled={!canRegenerateDraft(draft, isSaving || isRegenerating)}
              >
                {isRegenerating ? "생성 중" : "다시 생성"}
              </Button>
              {undoContent && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={undoRegeneration}
                >
                  다시 생성 되돌리기
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={assessReadiness}
                disabled={isSaving || isAssessingReadiness}
              >
                {isAssessingReadiness ? "점검 중" : "준비성 점검"}
              </Button>
              {conflict && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void reloadDraft()}
                >
                  최신 초안 불러오기
                </Button>
              )}
            </div>
          </header>

          {regeneratePrompt && (
            <RegenerateDialog
              prompt={regeneratePrompt}
              evidence={draft.evidence}
              busy={isRegenerating}
              onChange={setRegeneratePrompt}
              onCancel={() => setRegeneratePrompt(null)}
              onConfirm={() => void regenerateDraft(regeneratePrompt)}
            />
          )}

          {draft.blockers.map((blocker) => (
            <Alert
              tone="warning"
              className="work-brief-blocker"
              key={blocker.code}
              role="alert"
            >
              {blockReason(blocker.code)}
            </Alert>
          ))}

          {readiness && (
            <ReadinessPanel assessment={readiness} stale={readinessStale} />
          )}

          {/* Approval UI stays gated on a fresh readiness pass, but progress
              that already happened is always visible. */}
          {publication && (!readiness || hasHistoricalPublication) && (
            <PublicationProgress
              publication={publication}
              currentDraftVersion={draft.optimisticVersion}
            />
          )}

          {readiness && (
            <PublicationPanel
              draft={draft}
              readiness={readiness}
              readinessStale={readinessStale}
              publication={currentPublication}
              previews={publicationPreviews}
              approvals={publicationApprovals}
              isPublishing={isPublishing}
              isLoadingPreview={isLoadingPublicationPreview}
              onApprovalChange={updatePublicationApproval}
              onPrepare={(phase) => void preparePublicationPhase(phase)}
              onExecute={(phase) => void executePublicationPhase(phase)}
            />
          )}

          {editingContent ? (
            <>
              <EvidenceList evidence={editingEvidence} readonly />
              <CitationEditor
                label="제목"
                citation={editingContent.title}
                evidence={editingEvidence}
                onChange={(title) =>
                  updateContent((current) => ({ ...current, title }))
                }
              />
              <CitationEditor
                label="요약"
                citation={editingContent.summary}
                evidence={editingEvidence}
                multiline
                onChange={(summary) =>
                  updateContent((current) => ({ ...current, summary }))
                }
              />
              <CitationListEditor
                label="요구사항"
                items={editingContent.requirements}
                evidence={editingEvidence}
                onChange={(requirements) =>
                  updateContent((current) => ({ ...current, requirements }))
                }
              />
              <CitationListEditor
                label="완료 기준"
                items={editingContent.acceptanceCriteria}
                evidence={editingEvidence}
                emptyNotice={emptySectionNotice(
                  "acceptanceCriteria",
                  editingContent,
                  draft.evidence,
                )}
                onChange={(acceptanceCriteria) =>
                  updateContent((current) => ({
                    ...current,
                    acceptanceCriteria,
                  }))
                }
              />
              <CitationListEditor
                label="위험"
                items={editingContent.risks}
                evidence={editingEvidence}
                onChange={(risks) =>
                  updateContent((current) => ({ ...current, risks }))
                }
              />
              <CitationListEditor
                label="다음 단계"
                items={editingContent.nextSteps}
                evidence={editingEvidence}
                onChange={(nextSteps) =>
                  updateContent((current) => ({ ...current, nextSteps }))
                }
              />
              <ChildTaskEditor
                items={editingContent.childTasks}
                evidence={editingEvidence}
                emptyNotice={emptySectionNotice(
                  "childTasks",
                  editingContent,
                  draft.evidence,
                )}
                onChange={(childTasks) =>
                  updateContent((current) => ({ ...current, childTasks }))
                }
              />
              <div className="button-row">
                <Button
                  type="button"
                  onClick={saveDraft}
                  disabled={isSaving || draft.freshnessStatus !== "current"}
                >
                  초안 저장
                </Button>
                <span className="work-brief-save-note">
                  이 단계에서는 Jira·Confluence에 쓰지 않습니다.
                </span>
              </div>
            </>
          ) : (
            <Alert tone="warning" className="work-brief-access-limited">
              접근 권한이 변경되어 기존 브리프와 근거 제목을 표시하지 않습니다.
            </Alert>
          )}
        </section>
      )}
    </section>
  );
}

function ConnectionSummary({
  snapshot,
  onOpenIntegrations,
}: {
  snapshot: ConnectionSnapshot;
  onOpenIntegrations?: () => void;
}) {
  return (
    <section className="work-brief-connection">
      <h3 className="sr-only">Jira · Confluence 연결 상태</h3>
      {snapshot.state === "ready" ? (
        <ul className="work-brief-connection-list">
          {PROVIDER_ORDER.map((provider) => {
            const status = snapshot.byProvider[provider];
            return (
              <li key={provider}>
                <StatusIndicator tone={connectionTone(status)}>
                  {providerLabel[provider]} · {statusCopy[status].label}
                </StatusIndicator>
              </li>
            );
          })}
        </ul>
      ) : (
        <StatusIndicator tone="neutral">
          {snapshot.state === "loading"
            ? "연결 상태 확인 중"
            : "연결 상태를 확인할 수 없습니다"}
        </StatusIndicator>
      )}
      <button type="button" onClick={onOpenIntegrations}>
        연동 설정
      </button>
    </section>
  );
}

function EvidenceWorkspaceGroup({
  provider,
  evidence,
  selectedEvidenceIds,
  onToggle,
}: {
  provider: "jira" | "confluence";
  evidence: WorkEvidence[];
  selectedEvidenceIds: string[];
  onToggle: (id: string) => void;
}) {
  const label = provider === "jira" ? "Jira" : "Confluence";
  return (
    <section className="work-brief-evidence-group" aria-label={`${label} 근거`}>
      <header>
        <span className={`work-brief-source-icon work-brief-source-icon--${provider}`}>
          {provider === "jira" ? <IconBrandJira size={16} /> : <IconStack2 size={16} />}
        </span>
        <strong>{label}</strong>
        <span>{evidence.length}</span>
      </header>
      <ul>
        {evidence.map((item) => (
          <li key={item.id} className={selectedEvidenceIds.includes(item.id) ? "is-selected" : ""}>
            <Checkbox checked={selectedEvidenceIds.includes(item.id)} onChange={() => onToggle(item.id)} label={<span className="sr-only">{item.title} 선택</span>} />
            <div className="work-brief-evidence-copy">
              <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
              <span>{item.location ?? (provider === "jira" ? `프로젝트 / ${item.sourceId}` : `문서 / ${item.sourceId}`)}</span>
              <div>
                {(item.tags ?? (provider === "jira" ? ["이슈"] : ["문서"])).slice(0, 3).map((tag) => <em key={tag}>{tag}</em>)}
                {item.recommendationReasons?.length ? (
                  <em className="work-brief-recommendation">
                    추천 · {item.recommendationReasons.map(recommendationLabel).join(", ")}
                  </em>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function publicationPhaseLabel(phase: PublicationPhase): string {
  switch (phase) {
    case "confluence":
      return "Confluence 페이지";
    case "jira":
      return "Jira 링크와 댓글";
    case "child_tasks":
      return "Jira 하위 작업";
  }
}

function recommendationLabel(
  reason: NonNullable<WorkEvidence["recommendationReasons"]>[number],
): string {
  switch (reason) {
    case "source_jira":
      return "기준 이슈";
    case "linked_jira":
      return "연결 이슈";
    case "jira_issue":
      return "Jira 키";
    case "jira_summary":
      return "Jira 요약";
  }
}

const readinessStatusLabel: Record<ReadinessAssessment["status"], string> = {
  READY: "게시 준비 완료",
  NEEDS_ATTENTION: "검토 필요",
  BLOCKED: "게시 차단",
  ACCESS_LIMITED: "권한 확인 필요",
};

const readinessTone = (
  status: ReadinessAssessment["status"],
): "success" | "warning" | "danger" =>
  status === "READY" ? "success" : status === "BLOCKED" ? "danger" : "warning";

// Short category shown in place of the raw finding code. The code itself stays
// reachable through the row's `title` for support enquiries.
const readinessFindingTitle: Record<
  ReadinessAssessment["findings"][number]["code"],
  string
> = {
  COVERAGE_MISSING: "근거 연결",
  CREATE_FIELD_MISSING: "Jira 필수 field",
  CREATE_METADATA_ACCESS_LIMITED: "권한 확인",
  CREATE_METADATA_UNAVAILABLE: "Jira metadata",
  UNRESOLVED_BLOCKER: "미해결 blocker",
  ACCESS_LIMITED_DEPENDENCY: "권한 확인",
  FRESHNESS_REVIEW_REQUIRED: "근거 최신성",
  ACCESS_CHANGED: "접근 권한 변경",
  PROFILE_CHANGED: "연동 프로필",
};

function readinessFindingDescription(
  finding: ReadinessAssessment["findings"][number],
): string {
  switch (finding.code) {
    case "COVERAGE_MISSING": {
      const missing = (finding.missing ?? [])
        .map((item) =>
          item === "child_task" ? "선택한 하위 작업" : "검증 근거",
        )
        .join(", ");
      return `요구사항 ${(finding.requirementIndex ?? 0) + 1}: ${missing} 연결이 필요합니다.`;
    }
    case "CREATE_FIELD_MISSING":
      return `Jira 생성 필수 field ${finding.fieldId ?? ""}의 템플릿 값을 설정하세요.`;
    case "CREATE_METADATA_ACCESS_LIMITED":
      return "현재 사용자 권한으로 Jira 생성 필수 field를 확인할 수 없습니다.";
    case "CREATE_METADATA_UNAVAILABLE":
      return "Jira 생성 metadata를 확인할 수 없습니다.";
    case "UNRESOLVED_BLOCKER":
      return "해결되지 않은 Jira blocker가 있습니다.";
    case "ACCESS_LIMITED_DEPENDENCY":
      return "연결된 blocker의 접근 권한을 확인할 수 없습니다.";
    case "FRESHNESS_REVIEW_REQUIRED":
      return "근거 버전이 변경되었거나 다시 검토해야 합니다.";
    case "ACCESS_CHANGED":
      return "원본 또는 선택 근거 접근 권한이 변경되었습니다.";
    case "PROFILE_CHANGED":
      return "초안 생성에 사용한 연동 프로필이 더 이상 활성 상태가 아닙니다.";
  }
}

function ReadinessPanel({
  assessment,
  stale,
}: {
  assessment: ReadinessAssessment;
  stale: boolean;
}) {
  return (
    <section
      className={`work-brief-readiness ds-card readiness-${stale ? "needs_attention" : assessment.status.toLowerCase()}`}
      aria-label="통합 준비성 점검"
    >
      <header>
        <div>
          <p className="eyebrow">읽기 전용 점검</p>
          <h3>
            {stale ? "저장 후 다시 점검 필요" : readinessStatusLabel[assessment.status]}
          </h3>
        </div>
        {/* A stale assessment describes content the server has not seen. */}
        <Badge
          tone={
            stale
              ? "warning"
              : assessment.publishAllowed
                ? "success"
                : readinessTone(assessment.status)
          }
        >
          {stale
            ? "재점검 필요"
            : assessment.publishAllowed
              ? "게시 가능"
              : "게시 차단"}
        </Badge>
      </header>
      {stale && (
        <Alert tone="warning" className="work-brief-blocker">
          편집한 내용은 아직 점검하지 않았습니다. 초안을 저장하고 준비성 점검을
          다시 실행하세요.
        </Alert>
      )}
      {assessment.findings.length === 0 ? (
        <p>
          요구사항, 하위 작업, 검증 근거 및 Jira 생성 필수 field를 확인했습니다.
        </p>
      ) : (
        <ul>
          {assessment.findings.map((finding, index) => (
            <li
              key={`${finding.code}-${finding.fieldId ?? index}`}
              title={finding.code}
            >
              <strong>{readinessFindingTitle[finding.code]}</strong>
              <span>{readinessFindingDescription(finding)}</span>
            </li>
          ))}
        </ul>
      )}
      {assessment.blockers.length > 0 && (
        <ul className="work-brief-readiness-blockers">
          {assessment.blockers.map((blocker, index) =>
            blocker.kind === "visible_blocker" ? (
              <li key={blocker.issueKey}>
                <a href={blocker.url} target="_blank" rel="noreferrer">
                  {blocker.issueKey}
                </a>
                {blocker.crossProject && " · 다른 프로젝트"}
              </li>
            ) : (
              <li key={`access-limited-${index}`}>
                연결된 blocker의 제목과 식별자는 권한 확인 전 표시하지 않습니다.
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}

/**
 * The "다시 생성" confirmation.
 *
 * Regeneration overwrites hand-edited text, so the instruction, the evidence
 * selection and the overwrite warning are all in front of the user before the
 * request goes out.
 */
function RegenerateDialog({
  prompt,
  evidence,
  busy,
  onChange,
  onCancel,
  onConfirm,
}: {
  prompt: RegeneratePrompt;
  evidence: (WorkEvidence & { aiStatus?: "included" | "excluded" })[];
  busy: boolean;
  onChange: (prompt: RegeneratePrompt) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  function toggleEvidence(evidenceId: string) {
    onChange({
      ...prompt,
      selectedEvidenceIds: prompt.selectedEvidenceIds.includes(evidenceId)
        ? prompt.selectedEvidenceIds.filter((id) => id !== evidenceId)
        : [...prompt.selectedEvidenceIds, evidenceId],
    });
  }

  return (
    <section
      className="work-brief-regenerate ds-card"
      role="dialog"
      aria-label="브리프 다시 생성"
    >
      <h3>브리프 다시 생성</h3>
      <Alert tone="warning" role="alert">
        {REGENERATE_CONFIRM_NOTE}
      </Alert>
      <label>
        생성 지시문
        <TextArea
          value={prompt.instruction}
          rows={3}
          onChange={(event) =>
            onChange({ ...prompt, instruction: event.target.value })
          }
        />
      </label>
      <fieldset className="work-brief-regenerate-evidence">
        <legend>사용할 근거 ({prompt.selectedEvidenceIds.length}건)</legend>
        <EvidenceList
          evidence={evidence}
          selectedEvidenceIds={prompt.selectedEvidenceIds}
          onToggle={toggleEvidence}
        />
      </fieldset>
      <div className="button-row">
        <Button
          type="button"
          onClick={onConfirm}
          disabled={busy || prompt.instruction.trim().length === 0}
        >
          {busy ? "생성 중" : "덮어쓰고 다시 생성"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={busy}
        >
          취소
        </Button>
      </div>
    </section>
  );
}

function EvidenceList({
  evidence,
  selectedEvidenceIds = [],
  onToggle,
  readonly = false,
}: {
  evidence: (WorkEvidence & { aiStatus?: "included" | "excluded" })[];
  selectedEvidenceIds?: string[];
  onToggle?: (id: string) => void;
  readonly?: boolean;
}) {
  return (
    <ul className="work-brief-evidence-list" aria-label="선택 가능한 근거">
      {evidence.map((item) => (
        <li key={item.id}>
          {!readonly && (
            <Checkbox
              checked={selectedEvidenceIds.includes(item.id)}
              onChange={() => onToggle?.(item.id)}
              label={<span className="sr-only">{item.title} 근거 선택</span>}
            />
          )}
          <div>
            <a href={item.url} target="_blank" rel="noreferrer">
              {item.title}
            </a>
            <p>
              {item.provider} · v{item.version} · {item.excerptLength}자
            </p>
          </div>
          {item.aiStatus === "excluded" && (
            <span className="work-brief-ai-excluded-cell">
              <Badge tone="warning" className="work-brief-ai-excluded">
                AI 제외
              </Badge>
              {/* The reason is the model's own text, already masked by the
                  server. The source body itself stays hidden. */}
              <small>{excludedEvidenceReason(item)}</small>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function CitationEditor({
  label,
  citation,
  evidence,
  multiline = false,
  onChange,
}: {
  label: string;
  citation: EvidenceCitation;
  evidence: WorkEvidence[];
  multiline?: boolean;
  onChange: (value: EvidenceCitation) => void;
}) {
  function toggleCitation(evidenceId: string) {
    onChange({
      ...citation,
      userAuthored: true,
      evidenceIds: citation.evidenceIds.includes(evidenceId)
        ? citation.evidenceIds.filter((id) => id !== evidenceId)
        : [...citation.evidenceIds, evidenceId],
    });
  }

  return (
    <section className="work-brief-citation-editor ds-card">
      <h3>{label}</h3>
      {multiline ? (
        <TextArea
          value={citation.text}
          onChange={(event) =>
            onChange({
              ...citation,
              text: event.target.value,
              userAuthored: true,
            })
          }
        />
      ) : (
        <TextInput
          value={citation.text}
          onChange={(event) =>
            onChange({
              ...citation,
              text: event.target.value,
              userAuthored: true,
            })
          }
        />
      )}
      <fieldset>
        <legend>근거 연결</legend>
        {evidence.map((item) => (
          <Checkbox
            key={item.id}
            checked={citation.evidenceIds.includes(item.id)}
            onChange={() => toggleCitation(item.id)}
            label={item.title}
            description={`${providerLabel[item.provider]} · ${item.sourceId}`}
          />
        ))}
      </fieldset>
    </section>
  );
}

function CitationListEditor({
  label,
  items,
  evidence,
  emptyNotice,
  onChange,
}: {
  label: string;
  items: EvidenceCitation[];
  evidence: WorkEvidence[];
  /** Why the section is empty, when the AI was expected to fill it. */
  emptyNotice?: string | null;
  onChange: (items: EvidenceCitation[]) => void;
}) {
  const defaultEvidenceIds = evidence
    .filter((item) => item.aiStatus !== "excluded")
    .map((item) => item.id);

  return (
    <section className="work-brief-list-editor ds-card">
      <div className="work-brief-section-heading">
        <h3>{label}</h3>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            onChange([...items, emptyCitation(defaultEvidenceIds)])
          }
        >
          항목 추가
        </Button>
      </div>
      {items.length === 0 && emptyNotice ? (
        <p className="work-brief-section-empty">{emptyNotice}</p>
      ) : null}
      {items.map((item, index) => (
        <div className="work-brief-list-item" key={`${label}-${index}`}>
          <CitationEditor
            label={`${label} ${index + 1}`}
            citation={item}
            evidence={evidence}
            onChange={(next) =>
              onChange(
                items.map((current, currentIndex) =>
                  currentIndex === index ? next : current,
                ),
              )
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="work-brief-remove-button"
            onClick={() =>
              onChange(
                items.filter((_, currentIndex) => currentIndex !== index),
              )
            }
          >
            삭제
          </Button>
        </div>
      ))}
    </section>
  );
}

function ChildTaskEditor({
  items,
  evidence,
  emptyNotice,
  onChange,
}: {
  items: ChildTask[];
  evidence: WorkEvidence[];
  emptyNotice?: string | null;
  onChange: (items: ChildTask[]) => void;
}) {
  const defaultEvidenceIds = evidence
    .filter((item) => item.aiStatus !== "excluded")
    .map((item) => item.id);

  function addTask() {
    const clientTaskId = window.crypto.randomUUID();
    onChange([
      ...items,
      {
        ...emptyCitation(defaultEvidenceIds),
        clientTaskId,
        summary: "새 하위 작업",
        selected: true,
      },
    ]);
  }

  return (
    <section className="work-brief-list-editor ds-card">
      <div className="work-brief-section-heading">
        <h3>하위 작업</h3>
        <Button type="button" variant="secondary" size="sm" onClick={addTask}>
          하위 작업 추가
        </Button>
      </div>
      {items.length === 0 && emptyNotice ? (
        <p className="work-brief-section-empty">{emptyNotice}</p>
      ) : null}
      {items.map((item, index) => (
        <div className="work-brief-child-task ds-card" key={item.clientTaskId}>
          <Checkbox
            checked={item.selected}
            onChange={(event) =>
              onChange(
                items.map((current, currentIndex) =>
                  currentIndex === index
                    ? { ...current, selected: event.target.checked }
                    : current,
                ),
              )
            }
            label="게시 후보에 선택"
          />
          <label>
            작업 제목
            <TextInput
              value={item.summary}
              onChange={(event) =>
                onChange(
                  items.map((current, currentIndex) =>
                    currentIndex === index
                      ? {
                          ...current,
                          summary: event.target.value,
                          userAuthored: true,
                        }
                      : current,
                  ),
                )
              }
            />
          </label>
          <CitationEditor
            label="작업 근거"
            citation={item}
            evidence={evidence}
            onChange={(next) =>
              onChange(
                items.map((current, currentIndex) =>
                  currentIndex === index ? { ...current, ...next } : current,
                ),
              )
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="work-brief-remove-button"
            onClick={() =>
              onChange(
                items.filter((_, currentIndex) => currentIndex !== index),
              )
            }
          >
            삭제
          </Button>
        </div>
      ))}
    </section>
  );
}
