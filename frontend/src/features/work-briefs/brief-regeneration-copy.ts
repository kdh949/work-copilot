import type { BriefContent, BriefDraft, WorkEvidence } from "./work-briefs.types";

/** Shown before the request is sent. Regeneration is destructive by design. */
export const REGENERATE_CONFIRM_NOTE =
  "다시 생성하면 직접 고친 내용까지 서버가 만든 브리프로 모두 덮어씁니다. 되돌리기는 저장 전 1회만 가능합니다.";

export const REGENERATE_UNDO_NOTE =
  "다시 생성 직전 내용으로 되돌렸습니다. 저장해야 서버에 반영됩니다.";

/**
 * Why regeneration was refused.
 *
 * Every refusal here is a 409 the user cannot retry by pressing the button
 * again, so the copy names the action that does work. A stale draft has to be
 * refreshed and re-reviewed first — the server marks it for review in the same
 * response, which is why the screen has to reload it rather than keep showing
 * the old "current" state.
 */
export function regenerateFailureMessage(error: {
  status?: unknown;
  code?: unknown;
}): string {
  if (error.status !== 409) {
    return "브리프를 다시 생성하지 못했습니다. 연결 상태와 근거의 접근 권한을 확인하세요.";
  }
  if (error.code === "SOURCE_REVIEW_REQUIRED") {
    return "원본 이슈가 그사이 변경되어 다시 생성하지 않았습니다. 근거를 새로 고쳐 변경 내용을 검토한 뒤 다시 시도하세요.";
  }
  if (error.code === "ACCESS_CHANGED") {
    return "근거 접근 권한이 변경되어 다시 생성할 수 없습니다. 근거를 새로 고쳐 접근 상태를 확인하세요.";
  }
  if (error.code === "DRAFT_VERSION_CONFLICT") {
    return "초안이 다른 탭에서 변경되었습니다. 최신 초안을 불러온 뒤 다시 생성하세요.";
  }
  return "브리프를 다시 생성하지 못했습니다. 초안 상태를 확인하세요.";
}

/** Regeneration re-reads the sources, so it needs a current, idle draft. */
export function canRegenerateDraft(
  draft: BriefDraft | null,
  busy: boolean,
): boolean {
  return Boolean(draft && !busy && draft.freshnessStatus === "current");
}

/**
 * Why the model did not use this evidence.
 *
 * The reason is model-authored text that already passed the server DLP path.
 * When schema v1 produced the draft there is no reason to show, and inventing
 * one would be the screen speaking for the model.
 */
export function excludedEvidenceReason(
  evidence: Pick<WorkEvidence, "aiExclusionReason">,
): string {
  return (
    evidence.aiExclusionReason ??
    "AI가 생성한 초안에서 인용되지 않았습니다. 사유는 기록되지 않았습니다."
  );
}

/**
 * A draft written by schema v1: every item cites the whole evidence list and
 * neither acceptance criteria nor child tasks exist.
 *
 * These drafts are not migrated — which evidence supported which item cannot
 * be recovered after the fact, and guessing would put fabricated citations on
 * the screen. Regeneration is the only way forward, so the empty-state copy
 * has to say that instead of blaming the evidence.
 */
export function isLegacyBriefContent(
  content: BriefContent | null,
  evidence: readonly Pick<WorkEvidence, "id">[],
): boolean {
  // With a single evidence item "cites everything" is trivially true, so the
  // two cases are indistinguishable and the honest answer is "not legacy".
  if (!content || evidence.length < 2) return false;
  if (content.acceptanceCriteria.length > 0 || content.childTasks.length > 0) {
    return false;
  }

  const evidenceIds = new Set(evidence.map((item) => item.id));
  const citations = [
    content.title,
    content.summary,
    ...content.requirements,
    ...content.risks,
    ...content.nextSteps,
  ];

  return (
    citations.length > 0 &&
    citations.every(
      (citation) =>
        citation.evidenceIds.length === evidenceIds.size &&
        citation.evidenceIds.every((id) => evidenceIds.has(id)),
    )
  );
}

export type BriefSection = "acceptanceCriteria" | "childTasks";

const SECTION_LABEL: Record<BriefSection, string> = {
  acceptanceCriteria: "완료 기준",
  childTasks: "하위 작업",
};

/**
 * The empty-state line for a section the AI is expected to fill.
 *
 * "not generated yet" and "the evidence did not support it" look identical on
 * screen but need different actions, so they are never collapsed into one
 * message.
 */
export function emptySectionNotice(
  section: BriefSection,
  content: BriefContent | null,
  evidence: readonly Pick<WorkEvidence, "id">[],
): string | null {
  if (!content) return null;
  if (content[section].length > 0) return null;

  const label = SECTION_LABEL[section];
  return isLegacyBriefContent(content, evidence)
    ? `이 초안은 이전 버전 AI 출력으로 만들어져 ${label}이 없습니다. 다시 생성하면 채워집니다.`
    : `근거가 부족해 AI가 ${label}을 만들지 않았습니다. 직접 추가하거나 근거를 바꿔 다시 생성하세요.`;
}
