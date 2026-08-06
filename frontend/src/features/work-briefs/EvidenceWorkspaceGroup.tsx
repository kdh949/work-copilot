import { IconBrandJira, IconStack2 } from "@tabler/icons-react";
import { Checkbox } from "../../design-system/components";
import type { WorkEvidence } from "./work-briefs.types";

function recommendationLabel(
  reason: NonNullable<WorkEvidence["recommendationReasons"]>[number],
): string {
  switch (reason) {
    case "source_jira":
      return "기준 이슈";
    case "linked_jira":
      return "연결 이슈";
    case "jira_issue":
      return "Jira 키";
    case "jira_summary":
      return "Jira 요약";
  }
}

export function EvidenceWorkspaceGroup({
  provider,
  evidence,
  selectedEvidenceIds,
  onToggle,
}: {
  provider: "jira" | "confluence";
  evidence: WorkEvidence[];
  selectedEvidenceIds: string[];
  onToggle: (id: string) => void;
}) {
  const label = provider === "jira" ? "Jira" : "Confluence";
  return (
    <section className="work-brief-evidence-group" aria-label={`${label} 근거`}>
      <header>
        <span className={`work-brief-source-icon work-brief-source-icon--${provider}`}>
          {provider === "jira" ? <IconBrandJira size={16} /> : <IconStack2 size={16} />}
        </span>
        <strong>{label}</strong>
        <span>{evidence.length}</span>
      </header>
      <ul>
        {evidence.map((item) => (
          <li key={item.id} className={selectedEvidenceIds.includes(item.id) ? "is-selected" : ""}>
            <Checkbox checked={selectedEvidenceIds.includes(item.id)} onChange={() => onToggle(item.id)} label={<span className="sr-only">{item.title} 선택</span>} />
            <div className="work-brief-evidence-copy">
              <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
              <span>{item.location ?? (provider === "jira" ? `프로젝트 / ${item.sourceId}` : `문서 / ${item.sourceId}`)}</span>
              <div>
                {(item.tags ?? (provider === "jira" ? ["이슈"] : ["문서"])).slice(0, 3).map((tag) => <em key={tag}>{tag}</em>)}
                {item.recommendationReasons?.length ? (
                  <em className="work-brief-recommendation">
                    추천 · {item.recommendationReasons.map(recommendationLabel).join(", ")}
                  </em>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
