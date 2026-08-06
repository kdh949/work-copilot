import type { ReadinessAssessment } from "./work-briefs.types";

export const readinessStatusLabel: Record<
  ReadinessAssessment["status"],
  string
> = {
  READY: "게시 준비 완료",
  NEEDS_ATTENTION: "검토 필요",
  BLOCKED: "게시 차단",
  ACCESS_LIMITED: "권한 확인 필요",
};

export const readinessTone = (
  status: ReadinessAssessment["status"],
): "success" | "warning" | "danger" =>
  status === "READY" ? "success" : status === "BLOCKED" ? "danger" : "warning";

// Short category shown in place of the raw finding code. The code itself stays
// reachable through the row's `title` for support enquiries.
export const readinessFindingTitle: Record<
  ReadinessAssessment["findings"][number]["code"],
  string
> = {
  COVERAGE_MISSING: "근거 연결",
  CREATE_FIELD_MISSING: "Jira 필수 field",
  CREATE_METADATA_ACCESS_LIMITED: "권한 확인",
  CREATE_METADATA_UNAVAILABLE: "Jira metadata",
  UNRESOLVED_BLOCKER: "미해결 blocker",
  ACCESS_LIMITED_DEPENDENCY: "권한 확인",
  FRESHNESS_REVIEW_REQUIRED: "근거 최신성",
  ACCESS_CHANGED: "접근 권한 변경",
  PROFILE_CHANGED: "연동 프로필",
};

export function readinessFindingDescription(
  finding: ReadinessAssessment["findings"][number],
): string {
  switch (finding.code) {
    case "COVERAGE_MISSING": {
      const missing = (finding.missing ?? [])
        .map((item) =>
          item === "child_task" ? "선택한 하위 작업" : "검증 근거",
        )
        .join(", ");
      return `요구사항 ${(finding.requirementIndex ?? 0) + 1}: ${missing} 연결이 필요합니다.`;
    }
    case "CREATE_FIELD_MISSING":
      return `Jira 생성 필수 field ${finding.fieldId ?? ""}의 템플릿 값을 설정하세요.`;
    case "CREATE_METADATA_ACCESS_LIMITED":
      return "현재 사용자 권한으로 Jira 생성 필수 field를 확인할 수 없습니다.";
    case "CREATE_METADATA_UNAVAILABLE":
      return "Jira 생성 metadata를 확인할 수 없습니다.";
    case "UNRESOLVED_BLOCKER":
      return "해결되지 않은 Jira blocker가 있습니다.";
    case "ACCESS_LIMITED_DEPENDENCY":
      return "연결된 blocker의 접근 권한을 확인할 수 없습니다.";
    case "FRESHNESS_REVIEW_REQUIRED":
      return "근거 버전이 변경되었거나 다시 검토해야 합니다.";
    case "ACCESS_CHANGED":
      return "원본 또는 선택 근거 접근 권한이 변경되었습니다.";
    case "PROFILE_CHANGED":
      return "초안 생성에 사용한 연동 프로필이 더 이상 활성 상태가 아닙니다.";
  }
}
