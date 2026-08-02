import type {
  IntegrationConnectionTest,
  IntegrationProfile,
} from "./integration-profile.types";

type IntegrationProfileListProps = {
  profiles: IntegrationProfile[];
  testResults: Record<string, IntegrationConnectionTest>;
  isTestingProfileId: string | null;
  onEdit: (profile: IntegrationProfile) => void;
  onActivate: (profile: IntegrationProfile) => void;
  onDeactivate: (profile: IntegrationProfile) => void;
  onTest: (profile: IntegrationProfile) => void;
  onDelete: (profile: IntegrationProfile) => void;
};

const statusLabel = (status: string): string => {
  if (status === "reachable") return "확인됨";
  if (status === "authorization_required") return "사용자 권한 승인 필요";
  if (status === "not_configured") return "미설정";
  return "확인 실패";
};

function ConnectionResult({ result }: { result: IntegrationConnectionTest }) {
  const jiraStatuses = Object.entries(result.jira.allowedResources);
  const confluenceStatuses = Object.entries(result.confluence.allowedResources);

  return (
    <div className="connection-result" role="status">
      <strong>연결 확인 결과</strong>
      <p>Jira discovery: 확인됨 · Confluence discovery: 확인됨</p>
      {jiraStatuses.map(([key, status]) => (
        <p key={`jira-${key}`}>
          Jira 프로젝트 {key}: {statusLabel(status)}
        </p>
      ))}
      {confluenceStatuses.map(([key, status]) => (
        <p key={`confluence-${key}`}>
          Confluence space {key}: {statusLabel(status)}
        </p>
      ))}
      <p>브리프 상위 페이지: {statusLabel(result.confluence.parentPage)}</p>
    </div>
  );
}

export function IntegrationProfileList({
  profiles,
  testResults,
  isTestingProfileId,
  onEdit,
  onActivate,
  onDeactivate,
  onTest,
  onDelete,
}: IntegrationProfileListProps) {
  if (profiles.length === 0) {
    return (
      <section className="admin-empty-state" role="status">
        <h2>등록된 연동 프로필이 없습니다</h2>
        <p>
          허용된 Jira 프로젝트와 Confluence space만 포함한 프로필을 먼저
          저장하세요.
        </p>
      </section>
    );
  }

  return (
    <section className="integration-profile-list" aria-label="연동 프로필 목록">
      {profiles.map((profile) => (
        <article className="integration-profile-card" key={profile.id}>
          <div className="integration-profile-card-heading">
            <div>
              <h2>
                {profile.isActive
                  ? "활성 연동 프로필"
                  : "대기 중인 연동 프로필"}
              </h2>
              <p>{profile.jiraBaseUrl}</p>
              <p>{profile.confluenceBaseUrl}</p>
            </div>
            <span className={profile.isActive ? "status active" : "status"}>
              {profile.isActive ? "활성" : "비활성"}
            </span>
          </div>

          <dl className="integration-profile-details">
            <div>
              <dt>Jira scope</dt>
              <dd>{profile.jiraScopes.join(", ")}</dd>
            </div>
            <div>
              <dt>Confluence scope</dt>
              <dd>{profile.confluenceScopes.join(", ")}</dd>
            </div>
            <div>
              <dt>허용 프로젝트</dt>
              <dd>{profile.allowedProjectKeys.join(", ") || "없음"}</dd>
            </div>
            <div>
              <dt>허용 space</dt>
              <dd>{profile.allowedSpaceKeys.join(", ") || "없음"}</dd>
            </div>
            <div>
              <dt>하위 작업 issue type</dt>
              <dd>{profile.childTaskIssueTypeId ?? "미설정"}</dd>
            </div>
          </dl>

          <p className="secret-state">
            Jira secret{" "}
            {profile.jiraClientSecretConfigured ? "설정됨" : "미설정"} ·
            Confluence secret{" "}
            {profile.confluenceClientSecretConfigured ? "설정됨" : "미설정"} ·
            Webhook route secret{" "}
            {profile.webhookRouteSecretConfigured ? "설정됨" : "미설정"}
          </p>

          <div className="button-row">
            <button
              type="button"
              className="secondary"
              onClick={() => onEdit(profile)}
            >
              수정
            </button>
            <button
              type="button"
              className="secondary"
              disabled={isTestingProfileId === profile.id}
              onClick={() => onTest(profile)}
            >
              {isTestingProfileId === profile.id ? "확인 중" : "연결 확인"}
            </button>
            {!profile.isActive && (
              <button type="button" onClick={() => onActivate(profile)}>
                이 프로필 활성화
              </button>
            )}
            {profile.isActive && (
              <button
                type="button"
                className="danger"
                onClick={() => onDeactivate(profile)}
              >
                이 프로필 비활성화
              </button>
            )}
            {!profile.isActive && (
              <button
                type="button"
                className="danger"
                onClick={() => onDelete(profile)}
              >
                삭제
              </button>
            )}
          </div>

          {testResults[profile.id] && (
            <ConnectionResult result={testResults[profile.id]} />
          )}
        </article>
      ))}
    </section>
  );
}
