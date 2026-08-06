import type { ConfluenceSpaceOption } from "./work-briefs.types";

/**
 * How a space reads in the picker.
 *
 * The key is always shown: it is the value the search actually uses, and the
 * display name is only available when the user's own token could read the
 * space. Saying the name is unavailable is better than a row that looks
 * broken for no stated reason.
 */
export function spaceOptionLabel(option: ConfluenceSpaceOption): string {
  if (option.name) {
    return `${option.spaceKey} · ${option.name}`;
  }
  if (option.accessStatus === "not_requested") {
    return `${option.spaceKey} (표시명 미조회)`;
  }
  if (option.accessStatus === "accessible") {
    return option.spaceKey;
  }
  return `${option.spaceKey} (표시명 확인 불가)`;
}

/**
 * Why the dropdown is not there. In every one of these cases the free-text
 * key field stays usable, so the notice says that rather than implying the
 * search is unavailable.
 */
export function spaceListNotice(
  state: "loading" | "ready" | "unavailable",
  spaces: readonly ConfluenceSpaceOption[],
): string | null {
  if (state === "loading") return "허용된 space를 불러오는 중입니다.";
  if (state === "unavailable") {
    return "허용된 space 목록을 불러오지 못했습니다. space 키를 직접 입력하세요.";
  }
  return spaces.length === 0
    ? "이 프로필에 허용된 Confluence space가 없습니다. 관리자에게 문의하세요."
    : null;
}
