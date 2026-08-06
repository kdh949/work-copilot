import { Button } from "../../../design-system/components";
import type { EvidenceCitation, WorkEvidence } from "../work-briefs.types";
import { citationAnchorId } from "./citation-anchors";
import { CitationEditor } from "./CitationEditor";
import { emptyCitation } from "./empty-citation";

export function CitationListEditor({
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
            anchorId={citationAnchorId(label, index + 1)}
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
