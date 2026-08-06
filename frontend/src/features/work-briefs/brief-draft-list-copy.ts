import type { BriefDraftSummary } from "./work-briefs.types";

/**
 * What the list is allowed to say about a draft.
 *
 * When source access changes the server sends `title: null`, so there is no
 * title to fall back to. Saying so is the honest option; showing the issue key
 * as if it were the title would be the screen inventing content again.
 */
export function draftTitleText(summary: BriefDraftSummary): string {
  return summary.title ?? "접근 권한이 변경되어 제목을 표시할 수 없습니다.";
}

export function draftEvidenceCountText(summary: BriefDraftSummary): string {
  return summary.evidenceCount === null
    ? "근거 수 확인 불가"
    : `근거 ${summary.evidenceCount}건`;
}

export const draftStatusLabel: Record<BriefDraftSummary["status"], string> = {
  draft: "작성 중",
  review_required: "검토 필요",
};

/**
 * The publication badge. `externalWritePerformed` outranks the status because
 * it is the fact that decides whether the draft can still be deleted, and the
 * user needs to see it before they reach for the delete button.
 */
export function draftPublicationLabel(
  publication: BriefDraftSummary["publication"],
): string | null {
  if (!publication) return null;
  if (publication.status === "PUBLISHING") return "게시 진행 중";
  if (publication.status === "PUBLISHED") return "게시 완료";
  if (publication.externalWritePerformed) return "게시 이력 있음";
  return "게시 시도 있음";
}

export type DeleteRejection = {
  text: string;
  /** Whether the row should offer "열어서 재개" instead of a plain dismissal. */
  offersResume: boolean;
};

/**
 * Why a delete was refused.
 *
 * Both refusals come back as 409 with a code. Neither is retryable by pressing
 * the button again, so the copy has to point at the action that does work —
 * otherwise the user's next move is to delete from the database by hand, which
 * is exactly the path that produces duplicate Confluence pages.
 */
export function deleteRejectionReason(code: string | undefined): DeleteRejection {
  if (code === "PUBLICATION_IN_PROGRESS") {
    return {
      text: "게시가 진행 중입니다. 게시가 끝난 뒤 다시 시도하세요.",
      offersResume: true,
    };
  }
  if (code === "DRAFT_HAS_PUBLICATION") {
    return {
      text: "이미 Confluence에 게시된 초안은 지울 수 없습니다. 초안을 열어 재개하거나 재시도하세요. 지우고 같은 이슈로 다시 만들면 페이지가 중복 생성됩니다.",
      offersResume: true,
    };
  }
  return {
    text: "초안을 삭제하지 못했습니다. 잠시 후 다시 시도하세요.",
    offersResume: false,
  };
}

/** Shown in the delete confirmation. Retention is 90 days; say so up front. */
export const DELETE_CONFIRM_NOTE =
  "삭제하면 이 이슈로 새 브리프를 만들 수 있습니다. 복구는 관리자 문의로만 가능하며 90일이 지나면 불가능합니다.";
