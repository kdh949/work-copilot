import { useMemo, useState } from "react";
import type {
  BriefContent,
  BriefDraft,
  ChildTask,
  EvidenceCitation,
  EvidenceCollection,
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
  const [evidence, setEvidence] = useState<WorkEvidence[]>([]);
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<BriefDraft | null>(null);
  const [editingContent, setEditingContent] = useState<BriefContent | null>(
    null,
  );
  const [isLoadingEvidence, setIsLoadingEvidence] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);

  const selectedEvidence = useMemo(
    () => evidence.filter((item) => selectedEvidenceIds.includes(item.id)),
    [evidence, selectedEvidenceIds],
  );

  function applyDraft(nextDraft: BriefDraft) {
    setDraft(nextDraft);
    setEditingContent(nextDraft.content);
    setConflict(false);
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
        setEvidence([]);
        setSelectedEvidenceIds([]);
        setMessage("현재 사용자 권한으로 이슈 근거를 읽을 수 없습니다.");
        return;
      }
      setIssueKey(normalizedKey);
      setEvidence(result.evidence);
      setSelectedEvidenceIds(result.evidence.map((item) => item.id));
    } catch {
      setMessage(
        "이슈 근거를 불러오지 못했습니다. 연결 상태와 권한을 확인하세요.",
      );
    } finally {
      setIsLoadingEvidence(false);
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

  function updateContent(updater: (current: BriefContent) => BriefContent) {
    setEditingContent((current) => (current ? updater(current) : current));
  }

  const editingEvidence = draft?.evidence ?? selectedEvidence;

  return (
    <section className="work-brief-page" aria-labelledby="work-brief-title">
      <header className="work-brief-intro">
        <p className="eyebrow">권한 보존 · DLP 적용</p>
        <h1 id="work-brief-title">Jira 실행 브리프</h1>
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

        {evidence.length > 0 && (
          <EvidenceList
            evidence={evidence}
            selectedEvidenceIds={selectedEvidenceIds}
            onToggle={toggleEvidence}
          />
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
