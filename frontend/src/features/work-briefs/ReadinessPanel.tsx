import { Alert, Badge } from "../../design-system/components";
import {
  readinessFindingDescription,
  readinessFindingTitle,
  readinessStatusLabel,
  readinessTone,
} from "./readiness-copy";
import type { ReadinessAssessment } from "./work-briefs.types";

export function ReadinessPanel({
  assessment,
  stale,
}: {
  assessment: ReadinessAssessment;
  stale: boolean;
}) {
  return (
    <section
      className={`work-brief-readiness ds-card readiness-${stale ? "needs_attention" : assessment.status.toLowerCase()}`}
      aria-label="통합 준비성 점검"
    >
      <header>
        <div>
          <p className="eyebrow">읽기 전용 점검</p>
          <h3>
            {stale ? "저장 후 다시 점검 필요" : readinessStatusLabel[assessment.status]}
          </h3>
        </div>
        {/* A stale assessment describes content the server has not seen. */}
        <Badge
          tone={
            stale
              ? "warning"
              : assessment.publishAllowed
                ? "success"
                : readinessTone(assessment.status)
          }
        >
          {stale
            ? "재점검 필요"
            : assessment.publishAllowed
              ? "게시 가능"
              : "게시 차단"}
        </Badge>
      </header>
      {stale && (
        <Alert tone="warning" className="work-brief-blocker">
          편집한 내용은 아직 점검하지 않았습니다. 초안을 저장하고 준비성 점검을
          다시 실행하세요.
        </Alert>
      )}
      {assessment.findings.length === 0 ? (
        <p>
          요구사항, 하위 작업, 검증 근거 및 Jira 생성 필수 field를 확인했습니다.
        </p>
      ) : (
        <ul>
          {assessment.findings.map((finding, index) => (
            <li
              key={`${finding.code}-${finding.fieldId ?? index}`}
              title={finding.code}
            >
              <strong>{readinessFindingTitle[finding.code]}</strong>
              <span>{readinessFindingDescription(finding)}</span>
            </li>
          ))}
        </ul>
      )}
      {assessment.blockers.length > 0 && (
        <ul className="work-brief-readiness-blockers">
          {assessment.blockers.map((blocker, index) =>
            blocker.kind === "visible_blocker" ? (
              <li key={blocker.issueKey}>
                <a href={blocker.url} target="_blank" rel="noreferrer">
                  {blocker.issueKey}
                </a>
                {blocker.crossProject && " · 다른 프로젝트"}
              </li>
            ) : (
              <li key={`access-limited-${index}`}>
                연결된 blocker의 제목과 식별자는 권한 확인 전 표시하지 않습니다.
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
