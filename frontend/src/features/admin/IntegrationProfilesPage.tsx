import { useCallback, useEffect, useState } from "react";
import { Alert } from "../../design-system/components";
import { IntegrationProfileForm } from "./IntegrationProfileForm";
import { IntegrationProfileList } from "./IntegrationProfileList";
import { IntegrationOperationsPanel } from "./IntegrationOperationsPanel";
import type {
  ApiRequest,
  IntegrationConnectionTest,
  IntegrationProfile,
  IntegrationProfileInput,
  WorkCopilotOperationsHealth,
} from "./integration-profile.types";
import "./integration-profiles.css";

type IntegrationProfilesPageProps = {
  request: ApiRequest;
};

const endpoint = "/admin/integration-profiles";
const operationsEndpoint = "/admin/work-copilot/health";

const profileSaveErrorMessages: Record<string, string> = {
  INTEGRATION_PROFILE_BASE_URL_INVALID:
    "Jira와 Confluence URL은 공개 HTTPS URL이어야 하며, localhost·사설 IP·별도 포트·쿼리는 사용할 수 없습니다.",
  INTEGRATION_PROFILE_BASE_URL_HOST_NOT_ALLOWLISTED:
    "입력한 Jira 또는 Confluence 도메인이 서버의 허용 호스트 목록과 일치하지 않습니다. 배포 환경변수 INTEGRATION_BASE_URL_HOST_ALLOWLIST를 확인하세요.",
  INTEGRATION_PROFILE_BASE_URL_HOST_ALLOWLIST_NOT_CONFIGURED:
    "연동 서버의 허용 호스트 목록이 설정되지 않았습니다. 배포 환경변수 INTEGRATION_BASE_URL_HOST_ALLOWLIST에 Jira와 Confluence 도메인을 쉼표로 구분해 설정하세요.",
  INTEGRATION_PROFILE_SCOPE_ALLOWLIST_NOT_CONFIGURED:
    "연동 OAuth scope 허용 목록이 설정되지 않았습니다. 배포 환경변수 INTEGRATION_JIRA_SCOPE_ALLOWLIST와 INTEGRATION_CONFLUENCE_SCOPE_ALLOWLIST를 확인하세요.",
  INTEGRATION_PROFILE_SCOPE_NOT_ALLOWLISTED:
    "입력한 OAuth scope가 서버 허용 목록에 없습니다. 배포 환경변수의 허용 scope와 입력값을 일치시키세요.",
};

type ProfileRequestError = {
  detailCode?: unknown;
  correlationId?: unknown;
  status?: unknown;
};

const profileRequestError = (error: unknown): ProfileRequestError =>
  error && typeof error === "object" ? (error as ProfileRequestError) : {};

const errorCorrelationId = (error: ProfileRequestError): string | undefined =>
  typeof error.correlationId === "string" ? error.correlationId : undefined;

const withCorrelationId = (message: string, correlationId?: string): string =>
  correlationId ? `${message} (문의 ID: ${correlationId})` : message;

const profileSaveErrorMessage = (error: unknown): string => {
  const requestError = profileRequestError(error);
  const detailCode =
    typeof requestError.detailCode === "string"
      ? requestError.detailCode
      : undefined;
  const message =
    (detailCode && profileSaveErrorMessages[detailCode]) ||
    "프로필을 저장하지 못했습니다. 허용 Jira 프로젝트 키와 Confluence space 키를 각각 하나 이상 입력했는지 확인하세요.";

  return withCorrelationId(message, errorCorrelationId(requestError));
};

const profileTestErrorMessage = (error: unknown): string => {
  const requestError = profileRequestError(error);
  const message =
    requestError.status === 503
      ? "Jira 또는 Confluence OAuth Provider API에 도달하지 못했습니다. /rest/oauth2/latest/authorize 경로와 배포 서버의 REST API 접근을 확인하세요."
      : "연결을 확인하지 못했습니다. 저장된 URL과 네트워크 정책을 확인하세요.";

  return withCorrelationId(message, errorCorrelationId(requestError));
};

export function IntegrationProfilesPage({
  request,
}: IntegrationProfilesPageProps) {
  const [profiles, setProfiles] = useState<IntegrationProfile[]>([]);
  const [editingProfile, setEditingProfile] =
    useState<IntegrationProfile | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, IntegrationConnectionTest>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingProfileId, setIsTestingProfileId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState("");
  const [operationsHealth, setOperationsHealth] =
    useState<WorkCopilotOperationsHealth | null>(null);

  const loadProfiles = useCallback(async () => {
    try {
      setIsLoading(true);
      setProfiles(await request<IntegrationProfile[]>(endpoint));
    } catch {
      setError("연동 프로필을 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [request]);

  const loadOperationsHealth = useCallback(async () => {
    try {
      setOperationsHealth(
        await request<WorkCopilotOperationsHealth>(operationsEndpoint),
      );
    } catch {
      setOperationsHealth(null);
    }
  }, [request]);

  useEffect(() => {
    let isCurrent = true;

    void request<IntegrationProfile[]>(endpoint)
      .then((loadedProfiles) => {
        if (isCurrent) setProfiles(loadedProfiles);
      })
      .catch(() => {
        if (isCurrent) setError("연동 프로필을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    void request<WorkCopilotOperationsHealth>(operationsEndpoint)
      .then((health) => {
        if (isCurrent) setOperationsHealth(health);
      })
      .catch(() => {
        if (isCurrent) setOperationsHealth(null);
      });

    return () => {
      isCurrent = false;
    };
  }, [request]);

  async function saveProfile(input: IntegrationProfileInput) {
    try {
      setIsSaving(true);
      setError("");
      const payload = { ...input } as Record<string, unknown>;

      if (!payload.jiraClientSecret) delete payload.jiraClientSecret;
      if (!payload.confluenceClientSecret)
        delete payload.confluenceClientSecret;

      if (editingProfile) {
        await request(`${endpoint}/${editingProfile.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await request(endpoint, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      setEditingProfile(null);
      await loadProfiles();
      await loadOperationsHealth();
      return true;
    } catch (error) {
      setError(profileSaveErrorMessage(error));
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function activateProfile(profile: IntegrationProfile) {
    try {
      setError("");
      await request(`${endpoint}/${profile.id}/activate`, { method: "POST" });
      await loadProfiles();
      await loadOperationsHealth();
    } catch {
      setError("프로필을 활성화하지 못했습니다.");
    }
  }

  async function deactivateProfile(profile: IntegrationProfile) {
    if (!window.confirm("이 프로필을 비활성화하고 새 외부 작업을 멈출까요?")) {
      return;
    }

    try {
      setError("");
      await request(`${endpoint}/${profile.id}/deactivate`, { method: "POST" });
      await loadProfiles();
      await loadOperationsHealth();
    } catch {
      setError("프로필을 비활성화하지 못했습니다.");
    }
  }

  async function testProfile(profile: IntegrationProfile) {
    try {
      setError("");
      setIsTestingProfileId(profile.id);
      const result = await request<IntegrationConnectionTest>(
        `${endpoint}/${profile.id}/test`,
        { method: "POST" },
      );
      setTestResults((current) => ({ ...current, [profile.id]: result }));
    } catch (error) {
      setError(profileTestErrorMessage(error));
    } finally {
      setIsTestingProfileId(null);
    }
  }

  async function deleteProfile(profile: IntegrationProfile) {
    if (!window.confirm("이 비활성 프로필을 삭제할까요?")) return;

    try {
      setError("");
      await request(`${endpoint}/${profile.id}`, { method: "DELETE" });
      setEditingProfile((current) =>
        current?.id === profile.id ? null : current,
      );
      await loadProfiles();
      await loadOperationsHealth();
    } catch {
      setError(
        "프로필을 삭제하지 못했습니다. 활성 프로필은 먼저 다른 프로필을 활성화하세요.",
      );
    }
  }

  return (
    <section
      className="integration-admin-page"
      aria-labelledby="integration-admin-title"
    >
      <header className="integration-admin-intro">
        <p className="eyebrow">관리자 전용</p>
        <h1 id="integration-admin-title">Jira · Confluence 연동 프로필</h1>
        <p>
          활성 프로필은 하나만 허용됩니다. 연결 확인은 설정과 허용 범위만
          검사하며 외부 문서를 저장하지 않습니다.
        </p>
      </header>

      {error && (
        <Alert tone="warning" className="integration-admin-message">
          {error}
        </Alert>
      )}

      {operationsHealth && (
        <IntegrationOperationsPanel health={operationsHealth} />
      )}

      <div className="integration-admin-layout">
        <IntegrationProfileForm
          key={editingProfile?.id ?? "new"}
          profile={editingProfile}
          isSaving={isSaving}
          onSubmit={saveProfile}
          onCancelEdit={() => setEditingProfile(null)}
        />

        {isLoading ? (
          <section className="admin-empty-state ds-card" aria-busy="true" role="status">
            프로필을 불러오는 중입니다.
          </section>
        ) : (
          <IntegrationProfileList
            profiles={profiles}
            testResults={testResults}
            isTestingProfileId={isTestingProfileId}
            onEdit={setEditingProfile}
            onActivate={activateProfile}
            onDeactivate={deactivateProfile}
            onTest={testProfile}
            onDelete={deleteProfile}
          />
        )}
      </div>
    </section>
  );
}
