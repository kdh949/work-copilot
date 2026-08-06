import { Checkbox, TextArea, TextInput } from "../../../design-system/components";
import { providerLabel } from "../../integrations/connection-status";
import type { EvidenceCitation, WorkEvidence } from "../work-briefs.types";

export function CitationEditor({
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
    <section className="work-brief-citation-editor ds-card">
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
      <fieldset>
        <legend>근거 연결</legend>
        {evidence.map((item) => (
          <Checkbox
            key={item.id}
            checked={citation.evidenceIds.includes(item.id)}
            onChange={() => toggleCitation(item.id)}
            label={item.title}
            description={`${providerLabel[item.provider]} · ${item.sourceId}`}
          />
        ))}
      </fieldset>
    </section>
  );
}
