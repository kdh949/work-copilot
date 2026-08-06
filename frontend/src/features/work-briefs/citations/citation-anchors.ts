/**
 * DOM ids that let a chip and an evidence row point at each other.
 *
 * They are ids and not React refs because both directions cross component
 * boundaries: a chip inside a requirement scrolls to a row in the evidence
 * list, and a row scrolls back to the item that cites it. Threading refs
 * through every section to do that would couple them far harder than a name.
 */
export const evidenceRowId = (evidenceId: string): string =>
  `evidence-row-${evidenceId.replace(/[^A-Za-z0-9_-]/g, "_")}`;

const SECTION_KEYS: Record<string, string> = {
  제목: "title",
  요약: "summary",
  요구사항: "requirements",
  "완료 기준": "acceptance",
  위험: "risks",
  "다음 단계": "next-steps",
  "하위 작업": "child-tasks",
};

/** `index` is 1-based; `0` means the section holds a single item. */
export function citationAnchorId(section: string, index: number): string | null {
  const key = SECTION_KEYS[section];
  if (!key) return null;
  return index > 0 ? `citation-${key}-${index}` : `citation-${key}`;
}

/**
 * Bring an anchor into view and put the keyboard there too.
 *
 * Scrolling without moving focus is the usual half-fix: the sighted user finds
 * the row, and the keyboard user is still where they started.
 */
export function revealAnchor(elementId: string): void {
  if (typeof document === "undefined") return;
  const target = document.getElementById(elementId);
  if (!target) return;
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  target.focus({ preventScroll: true });
}
