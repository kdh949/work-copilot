import { useMemo } from "react";
import { Badge, Checkbox } from "../../../design-system/components";
import { excludedEvidenceReason } from "../brief-regeneration-copy";
import type { BriefContent, WorkEvidence } from "../work-briefs.types";
import {
  citationAnchorId,
  evidenceRowId,
  revealAnchor,
} from "./citation-anchors";
import { evidenceRefLabels } from "./evidence-refs";
import { evidenceUsage, evidenceUsageSummary } from "./evidence-usage";

export function EvidenceList({
  evidence,
  selectedEvidenceIds = [],
  onToggle,
  readonly = false,
  content = null,
}: {
  evidence: (WorkEvidence & { aiStatus?: "included" | "excluded" })[];
  selectedEvidenceIds?: string[];
  onToggle?: (id: string) => void;
  readonly?: boolean;
  /**
   * The draft being edited. Passing it turns on the reverse view: which items
   * cite each row. Omitted where there is no draft to reverse — the
   * regeneration dialog, for one.
   */
  content?: BriefContent | null;
}) {
  const labels = useMemo(() => evidenceRefLabels(evidence), [evidence]);
  // 15 evidence × 40 items is 600 steps; cheap enough to run per keystroke,
  // and there is no reason to.
  const usage = useMemo(() => evidenceUsage(content), [content]);

  return (
    <ul className="work-brief-evidence-list" aria-label="선택 가능한 근거">
      {evidence.map((item) => {
        const places = usage.get(item.id);
        const summary = evidenceUsageSummary(places);
        return (
          <li key={item.id} id={evidenceRowId(item.id)} tabIndex={-1}>
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
                {content ? (
                  <span className="work-brief-evidence-ref">
                    {labels.get(item.id)}
                  </span>
                ) : null}
                {item.provider} · v{item.version} · {item.excerptLength}자
              </p>
              {content ? (
                <p className="work-brief-evidence-usage">
                  {/* Read-only on purpose: unlinking lives in the popover
                      alone, so there is never a second place claiming
                      authority over the same state. */}
                  {summary && places ? (
                    <>
                      <span className="sr-only">사용처: {summary}</span>
                      {places.map((place, index) => {
                        const anchor = citationAnchorId(
                          place.section,
                          place.index,
                        );
                        const text =
                          place.index > 0
                            ? `${place.section} ${place.index}`
                            : place.section;
                        return (
                          <button
                            key={`${place.section}-${place.index}-${index}`}
                            type="button"
                            className="work-brief-usage-link"
                            disabled={!anchor}
                            onClick={() => anchor && revealAnchor(anchor)}
                          >
                            {text}
                          </button>
                        );
                      })}
                    </>
                  ) : (
                    // Evidence the user picked and then nothing cites is
                    // invisible everywhere else.
                    <Badge tone="warning">사용되지 않음</Badge>
                  )}
                </p>
              ) : null}
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
        );
      })}
    </ul>
  );
}
