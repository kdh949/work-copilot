import type { BriefContent, EvidenceCitation } from "../work-briefs.types";

export type EvidenceUsageEntry = {
  /** The section label as it reads on screen, e.g. "요구사항". */
  section: string;
  /** 1-based position within the section. `0` for the single-item sections. */
  index: number;
};

export type EvidenceUsage = EvidenceUsageEntry[];

/** Sections in the order the editor renders them. */
const SECTIONS: Array<{
  label: string;
  numbered: boolean;
  read: (content: BriefContent) => EvidenceCitation[];
}> = [
  { label: "제목", numbered: false, read: (content) => [content.title] },
  { label: "요약", numbered: false, read: (content) => [content.summary] },
  { label: "요구사항", numbered: true, read: (content) => content.requirements },
  {
    label: "완료 기준",
    numbered: true,
    read: (content) => content.acceptanceCriteria,
  },
  { label: "위험", numbered: true, read: (content) => content.risks },
  { label: "다음 단계", numbered: true, read: (content) => content.nextSteps },
  { label: "하위 작업", numbered: true, read: (content) => content.childTasks },
];

/**
 * Where each evidence id is used, keyed by id.
 *
 * This is the reverse of `EvidenceCitation.evidenceIds`, and it is read-only on
 * purpose: unlinking stays in the popover alone, so there is never a second
 * place that claims authority over the same state.
 *
 * `childTasks` are counted whether or not they are `selected`. Selection is a
 * publishing decision; a task the user has written still cites its evidence.
 */
export function evidenceUsage(
  content: BriefContent | null,
): Map<string, EvidenceUsage> {
  const usage = new Map<string, EvidenceUsage>();
  if (!content) return usage;

  for (const section of SECTIONS) {
    section.read(content).forEach((citation, position) => {
      const entry: EvidenceUsageEntry = {
        section: section.label,
        index: section.numbered ? position + 1 : 0,
      };
      // A citation that lists the same id twice is one use, not two.
      for (const evidenceId of new Set(citation.evidenceIds)) {
        const entries = usage.get(evidenceId);
        if (entries) {
          entries.push(entry);
        } else {
          usage.set(evidenceId, [entry]);
        }
      }
    });
  }

  return usage;
}

/**
 * The one-line summary on an evidence row: `요구사항 2 · 완료 기준 1`.
 *
 * Returns `null` when the evidence is used nowhere, so the caller renders the
 * explicit "사용되지 않음" badge instead of an empty cell. Unused evidence is
 * currently invisible everywhere, and an empty cell would keep it that way.
 */
export function evidenceUsageSummary(usage: EvidenceUsage | undefined): string | null {
  if (!usage || usage.length === 0) return null;
  const counts = new Map<string, number>();
  for (const entry of usage) {
    counts.set(entry.section, (counts.get(entry.section) ?? 0) + 1);
  }
  return [...counts].map(([section, count]) => `${section} ${count}`).join(" · ");
}
