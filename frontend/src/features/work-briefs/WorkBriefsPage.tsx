import { useMemo, useRef, useState } from "react";
import type {
  BriefPublication,
  BriefContent,
  BriefDraft,
  ChildTask,
  EvidenceCitation,
  EvidenceCollection,
  ReadinessAssessment,
  WorkBriefApiRequest,
  WorkEvidence,
} from "./work-briefs.types";
import "./work-briefs.css";

type WorkBriefsPageProps = {
  request: WorkBriefApiRequest;
};

type HttpError = Error & { status?: number };

const blockReason = (code: BriefDraft["blockers"][number]["code"]) =>
  code === "ACCESS_CHANGED"
    ? "원본 접근 권한이 바뀌었습니다. 관련 근거와 브리프는 다시 검토해야 합니다."
    : "근거 버전이 변경되었습니다. 최신 원본을 검토한 뒤 저장하세요.";

const emptyCitation = (evidenceIds: string[]): EvidenceCitation => ({
  text: "새 항목",
  evidenceIds,
  userAuthored: true,
});

export function WorkBriefsPage({ request }: WorkBriefsPageProps) {
  const [issueKey, setIssueKey] = useState("");
  const [instruction, setInstruction] = useState(
    "선택한 근거만 사용해 실행 브리프를 작성하세요.",
  );
  const [jiraEvidence, setJiraEvidence] = useState<WorkEvidence[]>([]);
  const [confluenceEvidence, setConfluenceEvidence] = useState<
    WorkEvidence[]
  >([]);
  const [confluenceSpaceKey, setConfluenceSpaceKey] = useState("");
  const [confluenceQuery, setConfluenceQuery] = useState("");
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<BriefDraft | null>(null);
  const [editingContent, setEditingContent] = useState<BriefContent | null>(
    null,
  );
  const [isLoadingEvidence, setIsLoadingEvidence] = useState(false);
  const [isLoadingConfluenceEvidence, setIsLoadingConfluenceEvidence] =
    useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [readiness, setReadiness] = useState<ReadinessAssessment | null>(null);
  const [isAssessingReadiness, setIsAssessingReadiness] = useState(false);
  const [publication, setPublication] = useState<BriefPublication | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishApproved, setPublishApproved] = useState(false);
  const idempotencyKeyRef = useRef<string | null>(null);

  const evidence = useMemo(
    () => [...jiraEvidence, ...confluenceEvidence],
    [jiraEvidence, confluenceEvidence],
  );

  const selectedEvidence = useMemo(
    () => evidence.filter((item) => selectedEvidenceIds.includes(item.id)),
    [evidence, selectedEvidenceIds],
  );

  function applyDraft(nextDraft: BriefDraft) {
    setDraft(nextDraft);
    setEditingContent(nextDraft.content);
    setConflict(false);
    setReadiness(null);
    setPublication(null);
    setPublishApproved(false);
    idempotencyKeyRef.current = null;
    void loadPublication(nextDraft.id);
  }

  async function collectEvidence() {
    const normalizedKey = issueKey.trim().toUpperCase();
    if (!normalizedKey) {
      setMessage("Jira 이슈 키를 입력하세요.");
      return;
    }

    try {
      setIsLoadingEvidence(true);
      setMessage("");
      const result = await request<EvidenceCollection>(
        `/work-items/jira/issues/${encodeURIComponent(normalizedKey)}`,
      );
      if (result.accessStatus !== "accessible") {
        setJiraEvidence([]);
        setConfluenceEvidence([]);
        setSelectedEvidenceIds([]);
        setMessage("현재 사용자 권한으로 이슈 근거를 읽을 수 없습니다.");
        return;
      }
      setIssueKey(normalizedKey);
      setJiraEvidence(result.evidence);
      setConfluenceEvidence([]);
      setSelectedEvidenceIds(result.evidence.map((item) => item.id));
    } catch {
      setMessage(
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
      setMessage("먼저 Jira 이슈 근거를 조회하세요.");
      return;
    }
    if (!spaceKey || !query) {
      setMessage("Confluence space 키와 검색어를 입력하세요.");
      return;
    }

    try {
      setIsLoadingConfluenceEvidence(true);
      setMessage("");
      const result = await request<EvidenceCollection>(
        `/work-items/confluence/spaces/${encodeURIComponent(spaceKey)}/search?q=${encodeURIComponent(query)}`,
      );
      if (result.accessStatus !== "accessible") {
        setConfluenceEvidence([]);
        setSelectedEvidenceIds((current) =>
          current.filter((id) => !id.startsWith("confluence:")),
        );
        setMessage("현재 사용자 권한으로 Confluence 근거를 읽을 수 없습니다.");
        return;
      }

      setConfluenceEvidence(result.evidence);
      setSelectedEvidenceIds((current) => [
        ...current.filter((id) => !id.startsWith("confluence:")),
        ...result.evidence.map((item) => item.id),
      ]);
    } catch {
      setMessage(
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
      setMessage("AI에 포함할 근거를 하나 이상 선택하세요.");
      return;
    }

    try {
      setIsSaving(true);
      setMessage("");
      applyDraft(
        await request<BriefDraft>("/brief-drafts", {
          method: "POST",
          body: JSON.stringify({
            sourceJiraKey: issueKey,
            selectedEvidenceIds,
            instruction,
          }),
        }),
      );
    } catch {
      setMessage(
        "브리프를 생성하지 못했습니다. AI 제외 사유와 연결 상태를 확인하세요.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function saveDraft() {
    if (!draft || !editingContent) return;

    try {
      setIsSaving(true);
      setMessage("");
      applyDraft(
        await request<BriefDraft>(`/brief-drafts/${draft.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            optimisticVersion: draft.optimisticVersion,
            content: editingContent,
          }),
        }),
      );
    } catch (error) {
      if ((error as HttpError).status === 409) {
        setConflict(true);
        setMessage(
          "다른 탭에서 먼저 저장했습니다. 최신 초안을 불러와 다시 검토하세요.",
        );
      } else {
        setMessage(
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
      setMessage("");
      applyDraft(
        await request<BriefDraft>(`/brief-drafts/${draft.id}/refresh`, {
          method: "POST",
          body: JSON.stringify({ optimisticVersion: draft.optimisticVersion }),
        }),
      );
    } catch (error) {
      if ((error as HttpError).status === 409) {
        setConflict(true);
        setMessage(
          "초안이 다른 탭에서 변경되었습니다. 최신 버전을 불러오세요.",
        );
      } else {
        setMessage("근거를 새로 고치지 못했습니다.");
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function reloadDraft() {
    if (!draft) return;
    try {
      applyDraft(await request<BriefDraft>(`/brief-drafts/${draft.id}`));
      setMessage("최신 초안을 불러왔습니다. 변경 내용을 다시 검토하세요.");
    } catch {
      setMessage("최신 초안을 불러오지 못했습니다.");
    }
  }

  async function assessReadiness() {
    if (!draft) return;

    try {
      setIsAssessingReadiness(true);
      setMessage("");
      setReadiness(
        await request<ReadinessAssessment>(
          `/brief-drafts/${draft.id}/readiness`,
        ),
      );
    } catch {
      setMessage(
        "준비성 점검을 완료하지 못했습니다. 연결 상태와 권한을 확인하세요.",
      );
    } finally {
      setIsAssessingReadiness(false);
    }
  }

  async function loadPublication(draftId: string) {
    try {
      setPublication(
        await request<BriefPublication>(`/brief-drafts/${draftId}/publication`),
      );
    } catch {
      setPublication(null);
    }
  }

  async function publishDraft() {
    if (!draft || !readiness?.publishAllowed) {
      setMessage("준비성 점검을 통과한 초안만 게시할 수 있습니다.");
      return;
    }
    if (!publishApproved) {
      setMessage("초안 버전을 검토한 뒤 게시 승인을 확인하세요.");
      return;
    }

    try {
      setIsPublishing(true);
      setMessage("");
      const idempotencyKey =
        idempotencyKeyRef.current ?? createIdempotencyKey();
      idempotencyKeyRef.current = idempotencyKey;
      setPublication(
        await request<BriefPublication>(`/brief-drafts/${draft.id}/publish`, {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({
            draftVersion: draft.optimisticVersion,
            approved: true,
          }),
        }),
      );
      setMessage("mock 게시 saga를 기록했습니다. 외부 Jira·Confluence에는 쓰지 않았습니다.");
    } catch (error) {
      if ((error as HttpError).status === 409) {
        setConflict(true);
        setMessage("초안 버전 또는 준비성 상태가 바뀌었습니다. 최신 초안을 다시 검토하세요.");
      } else {
        setMessage("mock 게시 saga를 시작하지 못했습니다.");
      }
    } finally {
      setIsPublishing(false);
    }
  }

  async function retryPublication() {
    if (!draft || !publication) return;
    if (!publishApproved) {
      setMessage("재시도할 현재 초안 버전을 다시 승인하세요.");
      return;
    }

    try {
      setIsPublishing(true);
      setMessage("");
      setPublication(
        await request<BriefPublication>(
          `/brief-drafts/${draft.id}/publication/${publication.id}/retry`,
          {
            method: "POST",
            body: JSON.stringify({
              draftVersion: draft.optimisticVersion,
              approved: true,
            }),
          },
        ),
      );
      setMessage("미완료 mock 단계만 다시 실행했습니다.");
    } catch (error) {
      if ((error as HttpError).status === 409) {
        setConflict(true);
        setMessage("재시도 전에 최신 초안과 준비성 결과를 다시 검토하세요.");
      } else {
        setMessage("mock 게시 복구를 완료하지 못했습니다.");
      }
    } finally {
      setIsPublishing(false);
    }
  }

  function updateContent(updater: (current: BriefContent) => BriefContent) {
    setEditingContent((current) => (current ? updater(current) : current));
  }

  const editingEvidence = draft?.evidence ?? selectedEvidence;

  return (
    <section className="work-brief-page" aria-labelledby="work-brief-title">
      <header className="work-brief-intro">
        <p className="eyebrow">권한 보존 · DLP 적용</p>
        <h1 id="work-brief-title">Jira · Confluence 실행 브리프</h1>
        <p>
          원문은 저장하지 않습니다. 선택한 근거만 현재 사용자 OAuth 권한으로
          다시 읽고, 마스킹된 초안과 근거 ID·URL·버전만 보관합니다.
        </p>
      </header>

      {message && (
        <p className="message" role="alert">
          {message}
        </p>
      )}

      <section className="work-brief-source panel">
        <h2>1. 이슈와 근거 선택</h2>
        <div className="work-brief-source-form">
          <label htmlFor="brief-issue-key">Jira 이슈 키</label>
          <div className="work-brief-inline-form">
            <input
              id="brief-issue-key"
              value={issueKey}
              placeholder="예: DEMO-123"
              onChange={(event) => setIssueKey(event.target.value)}
            />
            <button
              type="button"
              onClick={collectEvidence}
              disabled={isLoadingEvidence}
            >
              {isLoadingEvidence ? "조회 중" : "근거 조회"}
            </button>
          </div>
          <label htmlFor="brief-instruction">작성 지시</label>
          <textarea
            id="brief-instruction"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
          />
        </div>

        <section className="work-brief-confluence-source">
          <div>
            <h3>Confluence 추가 근거</h3>
            <p>
              선택 사항입니다. 허용된 space에서만 검색하며 페이지 원문은 이
              화면이나 브리프 DB에 저장하지 않습니다.
            </p>
          </div>
          <div className="work-brief-confluence-form">
            <label htmlFor="brief-confluence-space">Space 키</label>
            <input
              id="brief-confluence-space"
              value={confluenceSpaceKey}
              placeholder="예: ENG"
              onChange={(event) => setConfluenceSpaceKey(event.target.value)}
            />
            <label htmlFor="brief-confluence-query">검색어</label>
            <div className="work-brief-inline-form">
              <input
                id="brief-confluence-query"
                value={confluenceQuery}
                placeholder="예: 배포 결정"
                onChange={(event) => setConfluenceQuery(event.target.value)}
              />
              <button
                type="button"
                onClick={collectConfluenceEvidence}
                disabled={isLoadingConfluenceEvidence || isLoadingEvidence}
              >
                {isLoadingConfluenceEvidence ? "검색 중" : "근거 검색"}
              </button>
            </div>
          </div>
        </section>

        {jiraEvidence.length > 0 && (
          <section className="work-brief-evidence-section">
            <h3>Jira 근거</h3>
            <EvidenceList
              evidence={jiraEvidence}
              selectedEvidenceIds={selectedEvidenceIds}
              onToggle={toggleEvidence}
            />
          </section>
        )}
        {confluenceEvidence.length > 0 && (
          <section className="work-brief-evidence-section">
            <h3>Confluence 근거</h3>
            <EvidenceList
              evidence={confluenceEvidence}
              selectedEvidenceIds={selectedEvidenceIds}
              onToggle={toggleEvidence}
            />
          </section>
        )}
        <div className="button-row">
          <button
            type="button"
            onClick={createDraft}
            disabled={isSaving || selectedEvidenceIds.length === 0}
          >
            {isSaving ? "생성 중" : "마스킹 브리프 생성"}
          </button>
        </div>
      </section>

      {draft && (
        <section className="work-brief-editor" aria-live="polite">
          <header className="work-brief-draft-header">
            <div>
              <p className="eyebrow">초안 v{draft.optimisticVersion}</p>
              <h2>{draft.sourceJiraKey}</h2>
              <p>근거 기준 버전: {draft.sourceJiraVersion}</p>
            </div>
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                onClick={refreshDraft}
                disabled={isSaving}
              >
                근거 새로 고침
              </button>
              <button
                type="button"
                className="secondary"
                onClick={assessReadiness}
                disabled={isSaving || isAssessingReadiness}
              >
                {isAssessingReadiness ? "점검 중" : "준비성 점검"}
              </button>
              {conflict && (
                <button
                  type="button"
                  className="secondary"
                  onClick={reloadDraft}
                >
                  최신 초안 불러오기
                </button>
              )}
            </div>
          </header>

          {draft.blockers.map((blocker) => (
            <p className="work-brief-blocker" key={blocker.code} role="alert">
              {blockReason(blocker.code)}
            </p>
          ))}

          {readiness && <ReadinessPanel assessment={readiness} />}

          {readiness && (
            <PublicationPanel
              draft={draft}
              readiness={readiness}
              publication={publication}
              approved={publishApproved}
              isPublishing={isPublishing}
              onApprovalChange={setPublishApproved}
              onPublish={publishDraft}
              onRetry={retryPublication}
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
                onChange={(childTasks) =>
                  updateContent((current) => ({ ...current, childTasks }))
                }
              />
              <div className="button-row">
                <button
                  type="button"
                  onClick={saveDraft}
                  disabled={isSaving || draft.freshnessStatus !== "current"}
                >
                  초안 저장
                </button>
                <span className="work-brief-save-note">
                  이 단계에서는 Jira·Confluence에 쓰지 않습니다.
                </span>
              </div>
            </>
          ) : (
            <section className="work-brief-access-limited">
              접근 권한이 변경되어 기존 브리프와 근거 제목을 표시하지 않습니다.
            </section>
          )}
        </section>
      )}
    </section>
  );
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const readinessStatusLabel: Record<ReadinessAssessment["status"], string> = {
  READY: "게시 준비 완료",
  NEEDS_ATTENTION: "검토 필요",
  BLOCKED: "게시 차단",
  ACCESS_LIMITED: "권한 확인 필요",
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

function ReadinessPanel({ assessment }: { assessment: ReadinessAssessment }) {
  return (
    <section
      className={`work-brief-readiness readiness-${assessment.status.toLowerCase()}`}
      aria-label="통합 준비성 점검"
    >
      <header>
        <div>
          <p className="eyebrow">읽기 전용 점검</p>
          <h3>{readinessStatusLabel[assessment.status]}</h3>
        </div>
        <span>{assessment.publishAllowed ? "게시 가능" : "게시 차단"}</span>
      </header>
      {assessment.findings.length === 0 ? (
        <p>
          요구사항, 하위 작업, 검증 근거 및 Jira 생성 필수 field를 확인했습니다.
        </p>
      ) : (
        <ul>
          {assessment.findings.map((finding, index) => (
            <li key={`${finding.code}-${finding.fieldId ?? index}`}>
              <strong>{finding.code}</strong>
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

const publicationStatusLabel: Record<BriefPublication["status"], string> = {
  PENDING: "게시 대기",
  PUBLISHING: "게시 처리 중",
  PUBLISHED: "mock 게시 완료",
  PARTIALLY_PUBLISHED: "일부 단계 복구 필요",
  NEEDS_REVIEW: "충돌 검토 필요",
};

const publicationStepLabel = (key: string): string => {
  if (key === "confluence_page") return "Confluence 브리프";
  if (key === "jira_remote_link") return "Jira remote link";
  if (key === "jira_summary_comment") return "Jira 요약 댓글";
  return "선택한 Jira 하위 작업";
};

function PublicationPanel({
  draft,
  readiness,
  publication,
  approved,
  isPublishing,
  onApprovalChange,
  onPublish,
  onRetry,
}: {
  draft: BriefDraft;
  readiness: ReadinessAssessment;
  publication: BriefPublication | null;
  approved: boolean;
  isPublishing: boolean;
  onApprovalChange: (approved: boolean) => void;
  onPublish: () => void;
  onRetry: () => void;
}) {
  const publicationAllowed = readiness.publishAllowed && draft.freshnessStatus === "current";

  return (
    <section className="work-brief-publication" aria-label="브리프 게시">
      <header>
        <div>
          <p className="eyebrow">명시적 승인 · mock 검증</p>
          <h3>{publication ? publicationStatusLabel[publication.status] : "게시 전 확인"}</h3>
        </div>
        <span>외부 write 없음</span>
      </header>
      <p>
        현재 단계는 mock saga만 실행합니다. 실제 Jira·Confluence에 페이지, 링크,
        댓글 또는 하위 작업을 만들지 않습니다.
      </p>
      {publicationAllowed ? (
        <label className="work-brief-publish-approval">
          <input
            type="checkbox"
            checked={approved}
            onChange={(event) => onApprovalChange(event.target.checked)}
          />
          초안 v{draft.optimisticVersion}과 근거·준비성 결과를 검토하고 mock 게시를 승인합니다.
        </label>
      ) : (
        <p className="work-brief-blocker">
          준비성 점검과 freshness가 통과하기 전에는 게시 saga를 시작할 수 없습니다.
        </p>
      )}
      {publication?.steps.length ? (
        <ul className="work-brief-publication-steps">
          {publication.steps.map((step) => (
            <li key={step.key}>
              <strong>{publicationStepLabel(step.key)}</strong>
              <span>{step.status} · 시도 {step.attempts}회</span>
              {step.errorCode && <code>{step.errorCode}</code>}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="button-row">
        {!publication ? (
          <button
            type="button"
            onClick={onPublish}
            disabled={!publicationAllowed || !approved || isPublishing}
          >
            {isPublishing ? "mock 게시 중" : "mock 게시 승인"}
          </button>
        ) : publication.canRetry ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={!publicationAllowed || !approved || isPublishing}
          >
            {isPublishing
              ? "복구 중"
              : publication.requiresReview
                ? "충돌 검토 후 mock 재시도"
                : "미완료 mock 단계 재시도"}
          </button>
        ) : null}
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
            <input
              type="checkbox"
              checked={selectedEvidenceIds.includes(item.id)}
              onChange={() => onToggle?.(item.id)}
              aria-label={`${item.title} 근거 선택`}
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
            <span className="work-brief-ai-excluded">AI 제외</span>
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
    <section className="work-brief-citation-editor">
      <h3>{label}</h3>
      {multiline ? (
        <textarea
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
        <input
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
          <label key={item.id}>
            <input
              type="checkbox"
              checked={citation.evidenceIds.includes(item.id)}
              onChange={() => toggleCitation(item.id)}
            />
            {item.id}
          </label>
        ))}
      </fieldset>
    </section>
  );
}

function CitationListEditor({
  label,
  items,
  evidence,
  onChange,
}: {
  label: string;
  items: EvidenceCitation[];
  evidence: WorkEvidence[];
  onChange: (items: EvidenceCitation[]) => void;
}) {
  const defaultEvidenceIds = evidence
    .filter((item) => item.aiStatus !== "excluded")
    .map((item) => item.id);

  return (
    <section className="work-brief-list-editor">
      <div className="work-brief-section-heading">
        <h3>{label}</h3>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            onChange([...items, emptyCitation(defaultEvidenceIds)])
          }
        >
          항목 추가
        </button>
      </div>
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
          <button
            type="button"
            className="text-button"
            onClick={() =>
              onChange(
                items.filter((_, currentIndex) => currentIndex !== index),
              )
            }
          >
            삭제
          </button>
        </div>
      ))}
    </section>
  );
}

function ChildTaskEditor({
  items,
  evidence,
  onChange,
}: {
  items: ChildTask[];
  evidence: WorkEvidence[];
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
    <section className="work-brief-list-editor">
      <div className="work-brief-section-heading">
        <h3>하위 작업</h3>
        <button type="button" className="secondary" onClick={addTask}>
          하위 작업 추가
        </button>
      </div>
      {items.map((item, index) => (
        <div className="work-brief-child-task" key={item.clientTaskId}>
          <label>
            <input
              type="checkbox"
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
            />
            게시 후보에 선택
          </label>
          <label>
            작업 제목
            <input
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
          <button
            type="button"
            className="text-button"
            onClick={() =>
              onChange(
                items.filter((_, currentIndex) => currentIndex !== index),
              )
            }
          >
            삭제
          </button>
        </div>
      ))}
    </section>
  );
}
