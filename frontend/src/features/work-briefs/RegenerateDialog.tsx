import { Alert, Button, TextArea } from "../../design-system/components";
import { REGENERATE_CONFIRM_NOTE } from "./brief-regeneration-copy";
import { EvidenceList } from "./citations/EvidenceList";
import type { WorkEvidence } from "./work-briefs.types";

/** The open "다시 생성" dialog: what will be sent once the user confirms. */
export type RegeneratePrompt = {
  instruction: string;
  selectedEvidenceIds: string[];
};

/**
 * The "다시 생성" confirmation.
 *
 * Regeneration overwrites hand-edited text, so the instruction, the evidence
 * selection and the overwrite warning are all in front of the user before the
 * request goes out.
 */
export function RegenerateDialog({
  prompt,
  evidence,
  busy,
  onChange,
  onCancel,
  onConfirm,
}: {
  prompt: RegeneratePrompt;
  evidence: (WorkEvidence & { aiStatus?: "included" | "excluded" })[];
  busy: boolean;
  onChange: (prompt: RegeneratePrompt) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  function toggleEvidence(evidenceId: string) {
    onChange({
      ...prompt,
      selectedEvidenceIds: prompt.selectedEvidenceIds.includes(evidenceId)
        ? prompt.selectedEvidenceIds.filter((id) => id !== evidenceId)
        : [...prompt.selectedEvidenceIds, evidenceId],
    });
  }

  return (
    <section
      className="work-brief-regenerate ds-card"
      role="dialog"
      aria-label="브리프 다시 생성"
    >
      <h3>브리프 다시 생성</h3>
      <Alert tone="warning" role="alert">
        {REGENERATE_CONFIRM_NOTE}
      </Alert>
      <label>
        생성 지시문
        <TextArea
          value={prompt.instruction}
          rows={3}
          onChange={(event) =>
            onChange({ ...prompt, instruction: event.target.value })
          }
        />
      </label>
      <fieldset className="work-brief-regenerate-evidence">
        <legend>사용할 근거 ({prompt.selectedEvidenceIds.length}건)</legend>
        <EvidenceList
          evidence={evidence}
          selectedEvidenceIds={prompt.selectedEvidenceIds}
          onToggle={toggleEvidence}
        />
      </fieldset>
      <div className="button-row">
        <Button
          type="button"
          onClick={onConfirm}
          disabled={busy || prompt.instruction.trim().length === 0}
        >
          {busy ? "생성 중" : "덮어쓰고 다시 생성"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={busy}
        >
          취소
        </Button>
      </div>
    </section>
  );
}
