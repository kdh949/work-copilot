import type { BriefDraft, WorkBriefApiRequest, WorkEvidence } from "./work-briefs.types";

export const WORK_BRIEF_PREVIEW_USER = {
  id: 7,
  email: "sumin.lee@example.com",
  nickname: "이수민",
  department: "제품개발팀",
  employeeNumber: "P-0714",
  role: "member",
};
export const WORK_BRIEF_PREVIEW_ISSUE = "PROJ-284";

export const WORK_BRIEF_PREVIEW_EVIDENCE: WorkEvidence[] = [
  { id: "jira:PROJ-284", provider: "jira", sourceId: "PROJ-284", url: "#PROJ-284", title: "결제 실패 시 재시도 정책 정리", version: "18", excerptLength: 428, accessStatus: "accessible", dlpStatus: "not_evaluated", updatedAt: "2026-07-29T09:00:00Z", location: "결제 플랫폼 / 개선", tags: ["결제", "정책"], state: "current" },
  { id: "jira:PROJ-271", provider: "jira", sourceId: "PROJ-271", url: "#PROJ-271", title: "결제 오류 코드 표준화", version: "9", excerptLength: 366, accessStatus: "accessible", dlpStatus: "not_evaluated", updatedAt: "2026-07-27T09:00:00Z", location: "결제 플랫폼 / 백엔드", tags: ["API", "오류 코드"], state: "current" },
  { id: "jira:PROJ-263", provider: "jira", sourceId: "PROJ-263", url: "#PROJ-263", title: "PG사 장애 대응 체크리스트", version: "6", excerptLength: 312, accessStatus: "accessible", dlpStatus: "not_evaluated", updatedAt: "2026-07-25T09:00:00Z", location: "운영 / 장애 대응", tags: ["운영", "체크리스트"], state: "review" },
  { id: "confluence:PAY-42", provider: "confluence", sourceId: "PAY-42", url: "#PAY-42", title: "결제 재시도 정책 및 예외 처리", version: "12", excerptLength: 582, accessStatus: "accessible", dlpStatus: "not_evaluated", updatedAt: "2026-07-28T09:00:00Z", location: "PAY / 정책 문서", tags: ["정책", "예외 처리"], state: "current" },
  { id: "confluence:PAY-31", provider: "confluence", sourceId: "PAY-31", url: "#PAY-31", title: "PG 연동 운영 가이드", version: "21", excerptLength: 730, accessStatus: "accessible", dlpStatus: "not_evaluated", updatedAt: "2026-07-24T09:00:00Z", location: "PAY / 운영 가이드", tags: ["운영", "PG"], state: "current" },
  { id: "confluence:CS-18", provider: "confluence", sourceId: "CS-18", url: "#CS-18", title: "결제 문의 응대 기준", version: "4", excerptLength: 248, accessStatus: "accessible", dlpStatus: "not_evaluated", aiStatus: "excluded", updatedAt: "2026-07-21T09:00:00Z", location: "CS / 응대 기준", tags: ["고객 응대"], state: "review" },
];

const previewDraft: BriefDraft = {
  id: "preview-draft-1",
  sourceJiraKey: WORK_BRIEF_PREVIEW_ISSUE,
  sourceJiraVersion: "18",
  content: {
    title: { text: "결제 실패 재시도 정책 실행 브리프", evidenceIds: ["jira:PROJ-284"] },
    summary: { text: "재시도 조건과 예외 처리 기준을 정리합니다.", evidenceIds: ["jira:PROJ-284", "confluence:PAY-42"] },
    requirements: [{ text: "오류 코드별 재시도 횟수를 정의합니다.", evidenceIds: ["jira:PROJ-271"] }],
    acceptanceCriteria: [{ text: "정책에 따른 자동 재시도 결과를 확인합니다.", evidenceIds: ["confluence:PAY-42"] }],
    risks: [{ text: "PG사별 응답 차이를 검토합니다.", evidenceIds: ["confluence:PAY-31"] }],
    nextSteps: [{ text: "정책 리뷰 일정을 잡습니다.", evidenceIds: ["jira:PROJ-284"] }],
    childTasks: [],
  },
  evidence: WORK_BRIEF_PREVIEW_EVIDENCE.slice(0, 5).map((item) => ({ ...item, aiStatus: "included" as const })),
  status: "draft",
  freshnessStatus: "current",
  optimisticVersion: 1,
  blockers: [],
  updatedAt: new Date().toISOString(),
};

export const previewWorkBriefRequest: WorkBriefApiRequest = async <T>(path: string) => {
  if (path === "/brief-drafts") return previewDraft as T;
  if (path.includes("/publication")) throw Object.assign(new Error("게시 전"), { status: 404 });
  return previewDraft as T;
};
