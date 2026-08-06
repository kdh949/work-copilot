import type {
  BriefDraft,
  BriefDraftListView,
  BriefPublication,
  ChildTasksPublicationPreview,
  ConfluencePublicationPreview,
  EvidenceCollection,
  JiraPublicationPreview,
  ReadinessAssessment,
  WorkBriefApiRequest,
  WorkEvidence,
} from "./work-briefs.types";

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
  {
    id: "jira:PROJ-284",
    provider: "jira",
    sourceId: "PROJ-284",
    url: "#PROJ-284",
    title: "결제 실패 시 재시도 정책 정리",
    version: "18",
    excerptLength: 428,
    accessStatus: "accessible",
    dlpStatus: "not_evaluated",
    location: "결제 플랫폼 / 개선",
    tags: ["결제", "정책"],
  },
  {
    id: "jira:PROJ-271",
    provider: "jira",
    sourceId: "PROJ-271",
    url: "#PROJ-271",
    title: "결제 오류 코드 표준화",
    version: "9",
    excerptLength: 366,
    accessStatus: "accessible",
    dlpStatus: "not_evaluated",
    location: "결제 플랫폼 / 백엔드",
    tags: ["API", "오류 코드"],
  },
  {
    id: "jira:PROJ-263",
    provider: "jira",
    sourceId: "PROJ-263",
    url: "#PROJ-263",
    title: "PG사 장애 대응 체크리스트",
    version: "6",
    excerptLength: 312,
    accessStatus: "accessible",
    dlpStatus: "not_evaluated",
    location: "운영 / 장애 대응",
    tags: ["운영", "체크리스트"],
  },
  {
    id: "confluence:PAY-42",
    provider: "confluence",
    sourceId: "PAY-42",
    url: "#PAY-42",
    title: "결제 재시도 정책 및 예외 처리",
    version: "12",
    excerptLength: 582,
    accessStatus: "accessible",
    dlpStatus: "not_evaluated",
    location: "PAY / 정책 문서",
    tags: ["정책", "예외 처리"],
  },
  {
    id: "confluence:PAY-31",
    provider: "confluence",
    sourceId: "PAY-31",
    url: "#PAY-31",
    title: "PG 연동 운영 가이드",
    version: "21",
    excerptLength: 730,
    accessStatus: "accessible",
    dlpStatus: "not_evaluated",
    location: "PAY / 운영 가이드",
    tags: ["운영", "PG"],
  },
  {
    id: "confluence:CS-18",
    provider: "confluence",
    sourceId: "CS-18",
    url: "#CS-18",
    title: "결제 문의 응대 기준",
    version: "4",
    excerptLength: 248,
    accessStatus: "accessible",
    dlpStatus: "not_evaluated",
    aiStatus: "excluded",
    location: "CS / 응대 기준",
    tags: ["고객 응대"],
  },
];

const previewDraft: BriefDraft = {
  id: "preview-draft-1",
  sourceJiraKey: WORK_BRIEF_PREVIEW_ISSUE,
  sourceJiraVersion: "18",
  content: {
    title: {
      text: "결제 실패 재시도 정책 실행 브리프",
      evidenceIds: ["jira:PROJ-284"],
    },
    summary: {
      text: "재시도 조건과 예외 처리 기준을 정리합니다.",
      evidenceIds: ["jira:PROJ-284", "confluence:PAY-42"],
    },
    requirements: [
      {
        text: "오류 코드별 재시도 횟수를 정의합니다.",
        evidenceIds: ["jira:PROJ-271"],
      },
    ],
    acceptanceCriteria: [
      {
        text: "정책에 따른 자동 재시도 결과를 확인합니다.",
        evidenceIds: ["confluence:PAY-42"],
      },
    ],
    risks: [
      {
        text: "PG사별 응답 차이를 검토합니다.",
        evidenceIds: ["confluence:PAY-31"],
      },
    ],
    nextSteps: [
      { text: "정책 리뷰 일정을 잡습니다.", evidenceIds: ["jira:PROJ-284"] },
    ],
    childTasks: [
      {
        clientTaskId: "preview-child-task-1",
        text: "재시도 결과를 검증합니다.",
        summary: "결제 재시도 검증 시나리오 작성",
        evidenceIds: ["jira:PROJ-284", "confluence:PAY-42"],
        selected: true,
      },
    ],
  },
  evidence: WORK_BRIEF_PREVIEW_EVIDENCE.slice(0, 5).map((item, index) =>
    // One excluded item with its model reason, so the design QA screen shows
    // the state a real v2 draft produces.
    index === 4
      ? {
          ...item,
          aiStatus: "excluded" as const,
          aiExclusionReason:
            "재시도 정책과 직접 연결되는 내용이 없어 사용하지 않았습니다.",
        }
      : { ...item, aiStatus: "included" as const },
  ),
  status: "draft",
  freshnessStatus: "current",
  optimisticVersion: 1,
  blockers: [],
  updatedAt: new Date().toISOString(),
};

const draftPath = `/brief-drafts/${previewDraft.id}`;

const previewDraftList: BriefDraftListView = {
  items: [
    {
      id: previewDraft.id,
      sourceJiraKey: previewDraft.sourceJiraKey,
      title: previewDraft.content?.title.text ?? null,
      evidenceCount: previewDraft.evidence.length,
      status: previewDraft.status,
      freshnessStatus: previewDraft.freshnessStatus,
      optimisticVersion: previewDraft.optimisticVersion,
      blockers: previewDraft.blockers,
      publication: {
        id: "preview-publication",
        status: "CONFLUENCE_PUBLISHED",
        externalWritePerformed: true,
      },
      createdAt: previewDraft.updatedAt,
      updatedAt: previewDraft.updatedAt,
    },
    {
      id: "5a0a2f2c-0000-4000-8000-000000000002",
      sourceJiraKey: "PROJ-263",
      // Access changed: the server withholds the title and the count, and the
      // list has to survive that rather than invent a placeholder.
      title: null,
      evidenceCount: null,
      status: "review_required",
      freshnessStatus: "access_changed",
      optimisticVersion: 2,
      blockers: [{ code: "ACCESS_CHANGED" }],
      publication: null,
      createdAt: "2026-08-01T02:10:00.000Z",
      updatedAt: "2026-08-01T02:10:00.000Z",
    },
  ],
  nextCursor: null,
};

const readiness: ReadinessAssessment = {
  draftId: previewDraft.id,
  assessmentVersion: 1,
  status: "READY",
  publishAllowed: true,
  findings: [],
  blockers: [],
  evaluatedAt: "2026-08-04T09:00:00.000Z",
};

const confluencePreview: ConfluencePublicationPreview = {
  phase: "confluence",
  draftVersion: previewDraft.optimisticVersion,
  previewHash: "a".repeat(64),
  approvalRevision: 1,
  spaceKey: "PAY",
  parentPage: {
    id: "preview-parent-page",
    title: "결제 플랫폼 실행 브리프",
    url: "#preview-parent-page",
    version: "12",
  },
  pageTitle: "[PROJ-284] 결제 실패 재시도 정책 실행 브리프",
  bodyPreview:
    "<h1>결제 실패 재시도 정책 실행 브리프</h1>\n<p>근거 기반 실행 계획입니다.</p>",
  contentHash: "b".repeat(64),
  evidence: previewDraft.evidence.map((item) => ({
    id: item.id,
    provider: item.provider,
    title: item.title,
    url: item.url,
    version: item.version,
  })),
};

const confluencePage = {
  id: "preview-confluence-page",
  url: "#preview-confluence-page",
  title: confluencePreview.pageTitle,
};

const jiraPreview: JiraPublicationPreview = {
  phase: "jira",
  draftVersion: previewDraft.optimisticVersion,
  previewHash: "c".repeat(64),
  approvalRevision: 2,
  confluencePage,
  remoteLink: {
    globalId: "work-copilot:publication:preview-1",
    url: confluencePage.url,
    title: confluencePage.title,
  },
  summaryComment: {
    summary: previewDraft.content?.summary.text ?? "",
    url: confluencePage.url,
  },
};

const childTasksPreview: ChildTasksPublicationPreview = {
  phase: "child_tasks",
  draftVersion: previewDraft.optimisticVersion,
  previewHash: "d".repeat(64),
  approvalRevision: 3,
  configurationFingerprint: "e".repeat(64),
  childTasks:
    previewDraft.content?.childTasks
      .filter((task) => task.selected)
      .map((task) => ({
        clientTaskId: task.clientTaskId,
        summary: task.summary,
        payload: {
          project: { key: "DEMO" },
          issueType: { id: "10001" },
          parent: { id: "10000", key: "DEMO-1" },
          fields: {
            project: { key: "DEMO" },
            issuetype: { id: "10001" },
            parent: { id: "10000" },
            summary: task.summary,
          },
        },
      })) ?? [],
};

const publicationBase = {
  id: "preview-publication-1",
  draftId: previewDraft.id,
  draftVersion: previewDraft.optimisticVersion,
  executionMode: "mock" as const,
  externalWritePerformed: false,
  confluencePage: {
    id: confluencePage.id,
    version: "1",
    url: confluencePage.url,
    contentHash: confluencePreview.contentHash,
  },
  canRetry: true,
  requiresReview: false,
  updatedAt: "2026-08-04T09:05:00.000Z",
};

const confluencePublication: BriefPublication = {
  ...publicationBase,
  status: "CONFLUENCE_PUBLISHED",
  steps: [
    {
      key: "confluence_page",
      phase: "confluence",
      status: "SUCCEEDED",
      attempts: 1,
      errorCode: null,
      retryable: false,
    },
  ],
};

const jiraPublication: BriefPublication = {
  ...publicationBase,
  status: "JIRA_PUBLISHED",
  steps: [
    ...confluencePublication.steps,
    {
      key: "jira_remote_link",
      phase: "jira",
      status: "SUCCEEDED",
      attempts: 1,
      errorCode: null,
      retryable: false,
    },
    {
      key: "jira_summary_comment",
      phase: "jira",
      status: "SUCCEEDED",
      attempts: 1,
      errorCode: null,
      retryable: false,
    },
  ],
};

const completedPublication: BriefPublication = {
  ...publicationBase,
  status: "PUBLISHED",
  canRetry: false,
  steps: [
    ...jiraPublication.steps,
    {
      key: "jira_child_task:preview-child-task-1",
      phase: "child_tasks",
      status: "SUCCEEDED",
      attempts: 1,
      errorCode: null,
      retryable: false,
    },
  ],
};

let publication: BriefPublication | null = null;

export const previewWorkBriefRequest: WorkBriefApiRequest = async <T>(
  path: string,
  options?: RequestInit,
) => {
  const method = options?.method?.toUpperCase() ?? "GET";

  if (path === "/integrations") {
    return [
      { provider: "jira", status: "connected" },
      { provider: "confluence", status: "connected" },
    ] as T;
  }
  if (path === "/brief-drafts" && method === "POST") {
    publication = null;
    return previewDraft as T;
  }
  if (path.startsWith("/brief-drafts?") || path === "/brief-drafts") {
    return previewDraftList as T;
  }
  if (path === draftPath && method === "DELETE") {
    // The fixture draft carries publication history, so the preview shows the
    // refusal path rather than a delete that would never happen for real.
    throw Object.assign(new Error("게시 이력 있음"), {
      status: 409,
      code: "DRAFT_HAS_PUBLICATION",
    });
  }
  if (path.endsWith("/context")) {
    return {
      accessStatus: "accessible",
      evidence: WORK_BRIEF_PREVIEW_EVIDENCE.filter(
        (item) => item.provider === "jira",
      ),
      recommendations: WORK_BRIEF_PREVIEW_EVIDENCE.filter(
        (item) => item.provider === "confluence",
      ).map((item) => ({
        ...item,
        recommendationReasons: ["jira_issue"],
      })),
      recommendationAccessStatus: "accessible",
    } satisfies EvidenceCollection as T;
  }
  if (path.includes("/spaces/") && path.includes("/search")) {
    return {
      accessStatus: "accessible",
      evidence: WORK_BRIEF_PREVIEW_EVIDENCE.filter(
        (item) => item.provider === "confluence",
      ),
    } satisfies EvidenceCollection as T;
  }
  if (path === `${draftPath}/readiness`) return readiness as T;
  if (path === `${draftPath}/publication-preview`) {
    return confluencePreview as T;
  }
  if (path === `${draftPath}/publish` && method === "POST") {
    publication = confluencePublication;
    return publication as T;
  }
  if (path === `${draftPath}/publication`) {
    if (!publication) {
      throw Object.assign(new Error("게시 전"), { status: 404 });
    }
    return publication as T;
  }
  if (path.includes("/jira-preview")) return jiraPreview as T;
  if (path.endsWith("/jira") && method === "POST") {
    publication = jiraPublication;
    return publication as T;
  }
  if (path.includes("/child-tasks-preview")) return childTasksPreview as T;
  if (path.endsWith("/child-tasks") && method === "POST") {
    publication = completedPublication;
    return publication as T;
  }
  if (path.endsWith("/retry") && method === "POST") {
    const input = parsePreviewBody(options?.body);
    publication =
      input?.phase === "child_tasks"
        ? completedPublication
        : input?.phase === "jira"
          ? jiraPublication
          : confluencePublication;
    return publication as T;
  }
  if (path === draftPath || path.endsWith("/refresh") || method === "PATCH") {
    return previewDraft as T;
  }
  return previewDraft as T;
};

function parsePreviewBody(
  body: RequestInit["body"],
): { phase?: string } | null {
  if (typeof body !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as { phase?: string })
      : null;
  } catch {
    return null;
  }
}
