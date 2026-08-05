import { Alert, Badge, Button, Checkbox } from "../../design-system/components";
import type {
  BriefDraft,
  BriefPublication,
  ChildTasksPublicationPreview,
  ConfluencePublicationPreview,
  JiraPublicationPreview,
  PublicationPhase,
  PublicationPreviews,
  ReadinessAssessment,
} from "./work-briefs.types";
import { stepErrorDescription, stepStatusLabel } from "./publication-copy";

type PublicationPanelProps = {
  draft: BriefDraft;
  readiness: ReadinessAssessment;
  /** True when the draft was edited after the assessment ran. */
  readinessStale: boolean;
  publication: BriefPublication | null;
  previews: PublicationPreviews;
  approvals: Record<PublicationPhase, boolean>;
  isPublishing: boolean;
  isLoadingPreview: boolean;
  onApprovalChange: (phase: PublicationPhase, approved: boolean) => void;
  onPrepare: (phase: PublicationPhase) => void;
  onExecute: (phase: PublicationPhase) => void;
};

const phaseLabel: Record<PublicationPhase, string> = {
  confluence: "Confluence 페이지",
  jira: "Jira 링크와 댓글",
  child_tasks: "Jira 하위 작업",
};

const publicationStatusLabel: Record<BriefPublication["status"], string> = {
  PENDING: "게시 대기",
  PUBLISHING: "게시 처리 중",
  CONFLUENCE_PUBLISHED: "Confluence 게시 완료",
  JIRA_PUBLISHED: "Jira 반영 완료",
  PUBLISHED: "게시 완료",
  PARTIALLY_PUBLISHED: "일부 단계 복구 필요",
  NEEDS_REVIEW: "충돌 검토 필요",
};

export function PublicationPanel({
  draft,
  readiness,
  readinessStale,
  publication,
  previews,
  approvals,
  isPublishing,
  isLoadingPreview,
  onApprovalChange,
  onPrepare,
  onExecute,
}: PublicationPanelProps) {
  const publicationAllowed =
    readiness.publishAllowed &&
    draft.freshnessStatus === "current" &&
    !readinessStale;
  const phase = nextPhase(publication);
  const preview = phase ? previews[phase] : undefined;
  const status = publication?.status;
  const needsReview = publication?.requiresReview ?? false;
  const anotherRequestIsPublishing = status === "PUBLISHING" && !isPublishing;

  return (
    <section
      className="work-brief-publication ds-card"
      aria-label="브리프 게시"
    >
      <header>
        <div>
          <p className="eyebrow">단계별 미리보기 · 명시적 승인</p>
          <h3>{status ? publicationStatusLabel[status] : "게시 전 확인"}</h3>
        </div>
        <Badge tone={publicationTone(status)}>
          {publication?.executionMode === "real"
            ? publication.externalWritePerformed
              ? "외부 반영됨"
              : "실제 어댑터"
            : publication
              ? "mock 모드"
              : "승인 전"}
        </Badge>
      </header>

      {publication?.confluencePage?.url ? (
        <p className="work-brief-publication-link">
          Confluence 페이지:{" "}
          <a
            href={publication.confluencePage.url}
            target="_blank"
            rel="noreferrer"
          >
            열기
          </a>
          {publication.confluencePage.version
            ? ` · v${publication.confluencePage.version}`
            : ""}
        </p>
      ) : null}

      {publication?.steps.length ? (
        <PublicationSteps publication={publication} />
      ) : null}

      {anotherRequestIsPublishing ? (
        <Alert tone="warning" className="work-brief-blocker">
          다른 요청이 게시를 처리 중입니다. 완료 상태가 갱신될 때까지 중복 실행할 수 없습니다.
        </Alert>
      ) : null}

      {!publicationAllowed ? (
        <Alert tone="warning" className="work-brief-blocker">
          {readinessStale
            ? "편집한 내용을 저장하고 준비성 점검을 다시 실행해야 게시할 수 있습니다."
            : "준비성 점검과 근거 freshness가 통과하기 전에는 게시할 수 없습니다."}
        </Alert>
      ) : phase ? (
        <PublicationPhaseApproval
          draft={draft}
          phase={phase}
          preview={preview}
          approved={approvals[phase]}
          isPublishing={isPublishing}
          anotherRequestIsPublishing={anotherRequestIsPublishing}
          isLoadingPreview={isLoadingPreview}
          requiresReview={needsReview}
          onApprovalChange={onApprovalChange}
          onPrepare={onPrepare}
          onExecute={onExecute}
        />
      ) : (
        <p>선택한 모든 게시 단계가 완료되었습니다.</p>
      )}
    </section>
  );
}

function PublicationPhaseApproval({
  draft,
  phase,
  preview,
  approved,
  isPublishing,
  anotherRequestIsPublishing,
  isLoadingPreview,
  requiresReview,
  onApprovalChange,
  onPrepare,
  onExecute,
}: {
  draft: BriefDraft;
  phase: PublicationPhase;
  preview: PublicationPreviews[PublicationPhase];
  approved: boolean;
  isPublishing: boolean;
  anotherRequestIsPublishing: boolean;
  isLoadingPreview: boolean;
  requiresReview: boolean;
  onApprovalChange: (phase: PublicationPhase, approved: boolean) => void;
  onPrepare: (phase: PublicationPhase) => void;
  onExecute: (phase: PublicationPhase) => void;
}) {
  return (
    <section
      className="work-brief-publication-phase"
      aria-labelledby={`publication-phase-${phase}`}
    >
      <div className="work-brief-publication-phase__heading">
        <div>
          <p className="eyebrow">다음 단계</p>
          <h4 id={`publication-phase-${phase}`}>{phaseLabel[phase]}</h4>
        </div>
        {preview ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onPrepare(phase)}
            disabled={
              isLoadingPreview || isPublishing || anotherRequestIsPublishing
            }
          >
            {phaseLabel[phase]} 미리보기 다시 열기
          </Button>
        ) : null}
      </div>

      {preview ? (
        renderPreview(preview)
      ) : (
        <p>승인 전에 이 단계에서 외부 도구에 반영될 내용을 확인하세요.</p>
      )}

      {preview ? (
        <Checkbox
          className="work-brief-publish-approval"
          checked={approved}
          onChange={(event) => onApprovalChange(phase, event.target.checked)}
          label={`초안 v${draft.optimisticVersion}의 ${phaseLabel[phase]} 미리보기를 검토하고 이 단계만 승인합니다.`}
        />
      ) : null}

      <div className="button-row">
        {!preview ? (
          <Button
            type="button"
            onClick={() => onPrepare(phase)}
            disabled={
              isLoadingPreview || isPublishing || anotherRequestIsPublishing
            }
          >
            {isLoadingPreview
              ? "미리보기 준비 중"
              : `${phaseLabel[phase]} 미리보기 열기`}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => onExecute(phase)}
            disabled={
              !approved || isPublishing || anotherRequestIsPublishing
            }
          >
            {isPublishing
              ? "반영 중"
              : requiresReview
                ? `${phaseLabel[phase]} 다시 승인 및 실행`
                : `${phaseLabel[phase]} 승인 및 실행`}
          </Button>
        )}
      </div>
    </section>
  );
}

function renderPreview(
  preview:
    | ConfluencePublicationPreview
    | JiraPublicationPreview
    | ChildTasksPublicationPreview,
) {
  if (preview.phase === "confluence") {
    return <ConfluencePreview preview={preview} />;
  }
  if (preview.phase === "jira") {
    return <JiraPreview preview={preview} />;
  }
  return <ChildTasksPreview preview={preview} />;
}

function ConfluencePreview({
  preview,
}: {
  preview: ConfluencePublicationPreview;
}) {
  return (
    <div className="work-brief-publication-preview">
      <dl>
        <div>
          <dt>Space</dt>
          <dd>{preview.spaceKey}</dd>
        </div>
        <div>
          <dt>부모 페이지</dt>
          <dd>
            <a href={preview.parentPage.url} target="_blank" rel="noreferrer">
              {preview.parentPage.title}
            </a>{" "}
            · v{preview.parentPage.version}
          </dd>
        </div>
        <div>
          <dt>새 페이지 제목</dt>
          <dd>{preview.pageTitle}</dd>
        </div>
      </dl>
      <h5>본문 미리보기</h5>
      <pre>{preview.bodyPreview}</pre>
      <h5>사용한 근거</h5>
      <ul>
        {preview.evidence.map((evidence) => (
          <li key={evidence.id}>
            <a href={evidence.url} target="_blank" rel="noreferrer">
              {evidence.title}
            </a>{" "}
            · v{evidence.version}
          </li>
        ))}
      </ul>
    </div>
  );
}

function JiraPreview({ preview }: { preview: JiraPublicationPreview }) {
  return (
    <div className="work-brief-publication-preview">
      <dl>
        <div>
          <dt>Confluence 링크</dt>
          <dd>
            <a href={preview.remoteLink.url} target="_blank" rel="noreferrer">
              {preview.remoteLink.title}
            </a>
          </dd>
        </div>
        <div>
          <dt>중복 방지 키</dt>
          <dd>
            <code>{preview.remoteLink.globalId}</code>
          </dd>
        </div>
        <div>
          <dt>요약 댓글</dt>
          <dd>{preview.summaryComment.summary}</dd>
        </div>
      </dl>
    </div>
  );
}

function ChildTasksPreview({
  preview,
}: {
  preview: ChildTasksPublicationPreview;
}) {
  return (
    <div className="work-brief-publication-preview">
      <p>선택한 항목만 Jira 하위 작업으로 생성합니다.</p>
      <p>
        생성 설정 확인값: <code>{preview.configurationFingerprint}</code>
      </p>
      {preview.childTasks.length ? (
        <ul>
          {preview.childTasks.map((task) => (
            <li key={task.clientTaskId}>
              <p>{task.summary}</p>
              <dl>
                <div>
                  <dt>프로젝트</dt>
                  <dd>{task.payload.project.key}</dd>
                </div>
                <div>
                  <dt>이슈 유형</dt>
                  <dd>{task.payload.issueType.id}</dd>
                </div>
                <div>
                  <dt>상위 이슈</dt>
                  <dd>{task.payload.parent.key}</dd>
                </div>
              </dl>
              <pre>{JSON.stringify(task.payload.fields, null, 2)}</pre>
            </li>
          ))}
        </ul>
      ) : (
        <p>선택된 하위 작업이 없습니다.</p>
      )}
    </div>
  );
}

/**
 * Progress-only view for when the full approval panel is gated off — after a
 * save, readiness is intentionally cleared, but the steps that already ran
 * against Confluence and Jira still exist. Hiding them made a published page
 * look like it had disappeared.
 */
export function PublicationProgress({
  publication,
}: {
  publication: BriefPublication;
}) {
  return (
    <section className="work-brief-publication ds-card" aria-label="게시 진행 상황">
      <header>
        <div>
          <p className="eyebrow">이미 실행된 단계</p>
          <h3>{publicationStatusLabel[publication.status]}</h3>
        </div>
        <Badge tone={publicationTone(publication.status)}>
          {publication.executionMode === "real" ? "실제 어댑터" : "mock 모드"}
        </Badge>
      </header>

      {publication.confluencePage?.url ? (
        <p className="work-brief-publication-link">
          Confluence 페이지:{" "}
          <a href={publication.confluencePage.url} target="_blank" rel="noreferrer">
            열기
          </a>
          {publication.confluencePage.version
            ? ` · v${publication.confluencePage.version}`
            : ""}
        </p>
      ) : null}

      {publication.steps.length ? (
        <PublicationSteps publication={publication} />
      ) : null}

      <Alert tone="warning" className="work-brief-blocker">
        완료된 단계는 그대로 유지됩니다. 남은 단계를 이어서 진행하려면 준비성
        점검을 다시 실행하세요.
      </Alert>
    </section>
  );
}

function PublicationSteps({ publication }: { publication: BriefPublication }) {
  return (
    <ul className="work-brief-publication-steps">
      {publication.steps.map((step) => (
        <li key={step.key} title={step.errorCode ?? undefined}>
          <strong>{stepLabel(step.key)}</strong>
          <Badge tone={stepTone(step.status)}>
            {stepStatusLabel[step.status]}
            {step.attempts > 1 ? ` · 시도 ${step.attempts}회` : ""}
          </Badge>
          {step.errorCode ? (
            <span className="work-brief-step-error">
              {stepErrorDescription[step.errorCode]}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function nextPhase(
  publication: BriefPublication | null,
): PublicationPhase | null {
  if (!publication) return "confluence";
  const succeeded = (phase: PublicationPhase) => {
    const steps = publication.steps.filter((step) => step.phase === phase);
    return (
      steps.length > 0 && steps.every((step) => step.status === "SUCCEEDED")
    );
  };
  if (!succeeded("confluence")) return "confluence";
  if (!succeeded("jira")) return "jira";
  return publication.status === "PUBLISHED" ? null : "child_tasks";
}

function publicationTone(
  status: BriefPublication["status"] | undefined,
): "neutral" | "success" | "warning" {
  if (status === "PUBLISHED") return "success";
  if (status === "PARTIALLY_PUBLISHED" || status === "NEEDS_REVIEW")
    return "warning";
  return "neutral";
}

function stepTone(
  status: BriefPublication["steps"][number]["status"],
): "neutral" | "success" | "warning" | "danger" {
  if (status === "SUCCEEDED") return "success";
  if (status === "FAILED") return "danger";
  if (status === "NEEDS_REVIEW") return "warning";
  return "neutral";
}

function stepLabel(key: string): string {
  if (key === "confluence_page") return "Confluence 브리프";
  if (key === "jira_remote_link") return "Jira remote link";
  if (key === "jira_summary_comment") return "Jira 요약 댓글";
  return "선택한 Jira 하위 작업";
}
