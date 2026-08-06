import { Badge, Checkbox } from "../../../design-system/components";
import { excludedEvidenceReason } from "../brief-regeneration-copy";
import type { WorkEvidence } from "../work-briefs.types";

export function EvidenceList({
  evidence,
  selectedEvidenceIds = [],
  onToggle,
  readonly = false,
}: {
  evidence: (WorkEvidence & { aiStatus?: "included" | "excluded" })[];
  selectedEvidenceIds?: string[];
  onToggle?: (id: string) => void;
  readonly?: boolean;
}) {
  return (
    <ul className="work-brief-evidence-list" aria-label="선택 가능한 근거">
      {evidence.map((item) => (
        <li key={item.id}>
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
              {item.provider} · v{item.version} · {item.excerptLength}자
            </p>
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
      ))}
    </ul>
  );
}
