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
    } catch {
      setError(
        "프로필을 저장하지 못했습니다. HTTPS URL과 허용 scope를 다시 확인하세요.",
      );
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
    } catch {
      setError(
        "연결을 확인하지 못했습니다. 저장된 URL과 네트워크 정책을 확인하세요.",
      );
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
