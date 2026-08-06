import type { WorkEvidence } from "../work-briefs.types";

/**
 * Display-only reference numbers ("E1", "E2", …) for the evidence currently on
 * screen.
 *
 * The number is derived from the position in `draft.evidence` every render and
 * is never stored. It exists so a chip and a row in the evidence list can be
 * matched by eye; outside this screen it has no meaning.
 *
 * INVARIANT: a reference label must not reach the server or a published page.
 * `BriefContent` carries `evidenceIds`, and the publication preview is built by
 * the backend from ids and URLs. If a label were ever persisted, refreshing the
 * evidence would reorder the array and the published numbers would silently
 * start pointing at the wrong source — the exact class of lie phase 1 removed.
 * Keeping this module free of any payload-assembly import is what enforces it.
 */
export function evidenceRefLabels(
  evidence: readonly WorkEvidence[],
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const item of evidence) {
    // A duplicated id keeps its first label rather than taking a second
    // number, so two chips never disagree about the same evidence.
    if (!labels.has(item.id)) {
      labels.set(item.id, `E${labels.size + 1}`);
    }
  }
  return labels;
}

/**
 * Filter evidence by the popover's search box.
 *
 * Title, provider and sourceId are all searchable because the three are what a
 * user actually remembers about a source: its name, where it lives, and its
 * key. Case is ignored, and a blank query is not a filter.
 */
export function filterEvidence<T extends WorkEvidence>(
  evidence: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...evidence];
  return evidence.filter((item) =>
    [item.title, item.provider, item.sourceId].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}

export type CitationChips = {
  /** The chips to render, in evidence-list order. */
  shown: Array<{ id: string; label: string; excluded: boolean }>;
  /** How many linked ids are folded behind the "+N" chip. */
  overflow: number;
  /** Linked ids no longer present in the evidence array. */
  unknown: string[];
};

const MAX_SHOWN_CHIPS = 6;

/**
 * What a citation's chip row shows.
 *
 * Excluded evidence sorts first so that a warning-toned chip stays visible when
 * the rest of the row is folded into "+N": the collapsed state must not be able
 * to hide the one link the user would want to reconsider (R29).
 */
export function citationChips(
  evidenceIds: readonly string[],
  evidence: readonly WorkEvidence[],
  limit: number = MAX_SHOWN_CHIPS,
): CitationChips {
  const labels = evidenceRefLabels(evidence);
  const linked = new Set(evidenceIds);
  const known = evidence
    .filter((item) => linked.has(item.id))
    .map((item) => ({
      id: item.id,
      label: labels.get(item.id) ?? "",
      excluded: item.aiStatus === "excluded",
    }));
  const ordered = [
    ...known.filter((chip) => chip.excluded),
    ...known.filter((chip) => !chip.excluded),
  ];
  const knownIds = new Set(known.map((chip) => chip.id));

  return {
    shown: ordered.slice(0, limit),
    overflow: Math.max(ordered.length - limit, 0),
    // A stale id has no row to point at and no number to show. It is reported
    // rather than dropped so the caller can say "N건은 목록에 없습니다"
    // instead of quietly losing a link the draft still carries.
    unknown: [...linked].filter((id) => !knownIds.has(id)),
  };
}
