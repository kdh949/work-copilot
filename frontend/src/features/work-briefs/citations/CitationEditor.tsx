import { useId, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  TextArea,
  TextInput,
} from "../../../design-system/components";
import { Popover } from "../../../design-system/Popover";
import { providerLabel } from "../../integrations/connection-status";
import { excludedEvidenceReason } from "../brief-regeneration-copy";
import type { EvidenceCitation, WorkEvidence } from "../work-briefs.types";
import { evidenceRowId, revealAnchor } from "./citation-anchors";
import {
  citationChips,
  evidenceRefLabels,
  filterEvidence,
} from "./evidence-refs";

export function CitationEditor({
  label,
  citation,
  evidence,
  multiline = false,
  anchorId,
  onChange,
}: {
  label: string;
  citation: EvidenceCitation;
  evidence: WorkEvidence[];
  multiline?: boolean;
  /** Where the evidence list's reverse links point. */
  anchorId?: string | null;
  onChange: (value: EvidenceCitation) => void;
}) {
  const popoverId = useId();
  const [query, setQuery] = useState("");
  const chips = useMemo(
    () => citationChips(citation.evidenceIds, evidence),
    [citation.evidenceIds, evidence],
  );
  const labels = useMemo(() => evidenceRefLabels(evidence), [evidence]);

  function toggleCitation(evidenceId: string) {
    onChange({
      ...citation,
      userAuthored: true,
      evidenceIds: citation.evidenceIds.includes(evidenceId)
        ? citation.evidenceIds.filter((id) => id !== evidenceId)
        : [...citation.evidenceIds, evidenceId],
    });
  }

  const linkedCount = citation.evidenceIds.length;
  const included = evidence.filter((item) => item.aiStatus !== "excluded");
  const excluded = evidence.filter((item) => item.aiStatus === "excluded");
  const matchedIncluded = filterEvidence(included, query);
  const matchedExcluded = filterEvidence(excluded, query);

  return (
    <section
      className="work-brief-citation-editor ds-card"
      id={anchorId ?? undefined}
      tabIndex={anchorId ? -1 : undefined}
    >
      <h3>{label}</h3>
      {multiline ? (
        <TextArea
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
        <TextInput
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
      <div className="work-brief-citation-links">
        <span className="sr-only">{label} 근거 연결</span>
        {linkedCount === 0 ? (
          // An empty link set is drawn, not left as whitespace. Readiness
          // catches it too, but only at publish time — far too late to be the
          // first time the user hears about it (R26).
          <span className="work-brief-chip work-brief-chip--empty">
            근거 없음
          </span>
        ) : (
          chips.shown.map((chip) => {
            const item = evidence.find((candidate) => candidate.id === chip.id);
            const title = item?.title ?? chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                className={[
                  "work-brief-chip",
                  chip.excluded ? "work-brief-chip--warning" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                // The number means nothing when read aloud, so the accessible
                // name is the title. `title=` is not used: it never appears
                // for a keyboard user.
                aria-label={
                  chip.excluded ? `${title} (AI 제외)` : title
                }
                data-tooltip={title}
                onClick={() => revealAnchor(evidenceRowId(chip.id))}
              >
                {chip.label}
              </button>
            );
          })
        )}
        {chips.unknown.length > 0 ? (
          <span className="work-brief-chip work-brief-chip--warning">
            목록에 없는 근거 {chips.unknown.length}건
          </span>
        ) : null}
        <Popover
          id={popoverId}
          panelLabel={`${label} 근거 연결`}
          triggerLabel={`근거 편집 (${linkedCount})`}
          className="work-brief-citation-popover"
          onOpenChange={(open) => {
            if (open) setQuery("");
          }}
          extraTrigger={
            chips.overflow > 0
              ? (attributes) => (
                  <button
                    type="button"
                    className="work-brief-chip work-brief-chip--overflow"
                    aria-label={`나머지 근거 ${chips.overflow}건 보기`}
                    {...attributes}
                  >
                    +{chips.overflow}
                  </button>
                )
              : undefined
          }
        >
          {({ close }) => (
            <div className="work-brief-citation-picker">
              <label className="work-brief-citation-search">
                <span className="sr-only">근거 검색</span>
                <TextInput
                  value={query}
                  data-popover-autofocus
                  placeholder="제목 · 제공자 · 키로 검색"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              {matchedIncluded.length === 0 ? (
                <p className="work-brief-section-empty">
                  검색과 일치하는 근거가 없습니다.
                </p>
              ) : (
                matchedIncluded.map((item) => (
                  <Checkbox
                    key={item.id}
                    checked={citation.evidenceIds.includes(item.id)}
                    onChange={() => toggleCitation(item.id)}
                    label={item.title}
                    description={`${labels.get(item.id) ?? ""} · ${
                      providerLabel[item.provider]
                    } · ${item.sourceId}`}
                  />
                ))
              )}
              {excluded.length > 0 ? (
                // Collapsed, but the count is in the label: the model's
                // judgement stays visible enough to be reconsidered (R29).
                <details className="work-brief-citation-excluded">
                  <summary>AI가 제외한 근거 {excluded.length}건 보기</summary>
                  {matchedExcluded.length === 0 ? (
                    <p className="work-brief-section-empty">
                      검색과 일치하는 제외 근거가 없습니다.
                    </p>
                  ) : (
                    matchedExcluded.map((item) => (
                      <Checkbox
                        key={item.id}
                        checked={citation.evidenceIds.includes(item.id)}
                        onChange={() => toggleCitation(item.id)}
                        label={item.title}
                        description={`${labels.get(item.id) ?? ""} · ${
                          providerLabel[item.provider]
                        } · ${excludedEvidenceReason(item)}`}
                      />
                    ))
                  )}
                </details>
              ) : null}
              {/* Only 닫기. An 적용/취소 pair would compete with the click
                  outside that already dismisses the panel, and changes are
                  applied the moment they are made. */}
              <div className="button-row">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={close}
                >
                  닫기
                </Button>
              </div>
            </div>
          )}
        </Popover>
      </div>
    </section>
  );
}
