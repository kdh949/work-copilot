import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  StatusIndicator,
} from "../../design-system/components";
import type { ApiRequest } from "../admin/integration-profile.types";
import "./integration-connections.css";

type IntegrationProvider = "jira" | "confluence";
type ConnectionStatus =
  | "connected"
  | "expired"
  | "reauthorization_required"
  | "authorization_required";

type IntegrationConnection = {
  provider: IntegrationProvider;
  status: ConnectionStatus;
};

type AuthorizationResponse = {
  authorizationUrl: string;
};

type IntegrationConnectionsPageProps = {
  request: ApiRequest;
};

const providers: Array<{
  id: IntegrationProvider;
  name: string;
  description: string;
}> = [
  {
    id: "jira",
    name: "Jira",
    description: "이슈, 연결된 작업, 생성 필수 field를 읽습니다.",
  },
  {
    id: "confluence",
    name: "Confluence",
    description: "허용된 space의 페이지 근거만 읽습니다.",
  },
];

const statusCopy: Record<ConnectionStatus, { label: string; detail: string }> = {
  connected: {
    label: "연결됨",
    detail: "현재 사용자 권한으로 필요한 읽기 전용 요청을 수행할 수 있습니다.",
  },
  expired: {
    label: "만료됨",
    detail: "다시 연결하면 사용자 OAuth 권한을 갱신할 수 있습니다.",
  },
  reauthorization_required: {
    label: "재연결 필요",
    detail: "토큰을 갱신할 수 없습니다. 현재 사용자로 다시 승인하세요.",
  },
  authorization_required: {
    label: "연결 필요",
    detail: "아직 이 서비스에 대한 사용자 OAuth 권한이 없습니다.",
  },
};

export function IntegrationConnectionsPage({
  request,
}: IntegrationConnectionsPageProps) {
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingProvider, setPendingProvider] =
    useState<IntegrationProvider | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let isCurrent = true;

    void request<IntegrationConnection[]>("/integrations")
      .then((loadedConnections) => {
        if (isCurrent) setConnections(loadedConnections);
      })
      .catch(() => {
        if (isCurrent) {
          setMessage("연결 상태를 불러오지 못했습니다. 로그인 상태를 확인하세요.");
        }
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [request]);

  async function startAuthorization(provider: IntegrationProvider) {
    try {
      setPendingProvider(provider);
      setMessage("");
      const result = await request<AuthorizationResponse>(
        `/integrations/${provider}/authorize`,
        { method: "POST" },
      );
      const authorizationUrl = safeAuthorizationUrl(result.authorizationUrl);

      // Navigation is deliberately user-initiated. This screen never begins an
      // external OAuth flow while it is merely being rendered or tested.
      window.location.assign(authorizationUrl);
    } catch {
      setMessage(
        "연결을 시작하지 못했습니다. 활성 연동 프로필과 사용자 권한을 확인하세요.",
      );
      setPendingProvider(null);
    }
  }

  async function disconnect(provider: IntegrationProvider) {
    if (!window.confirm(`${provider === "jira" ? "Jira" : "Confluence"} 연결을 해제할까요?`)) {
      return;
    }

    try {
      setPendingProvider(provider);
      setMessage("");
      await request(`/integrations/${provider}`, { method: "DELETE" });
      setConnections((current) =>
        current.map((connection) =>
          connection.provider === provider
            ? { ...connection, status: "authorization_required" }
            : connection,
        ),
      );
      setMessage("연결을 해제했습니다. 저장된 사용자 OAuth 토큰은 더 이상 사용하지 않습니다.");
    } catch {
      setMessage("연결을 해제하지 못했습니다. 잠시 후 다시 시도하세요.");
    } finally {
      setPendingProvider(null);
    }
  }

  const connectionByProvider = new Map(
    connections.map((connection) => [connection.provider, connection]),
  );
  const profileUnavailable = !isLoading && connections.length === 0;

  return (
    <section
      className="integration-connections-page"
      aria-labelledby="integration-connections-title"
    >
      <header className="integration-connections-intro">
        <p className="eyebrow">내 사용자 OAuth 연결</p>
        <h1 id="integration-connections-title">Jira · Confluence 연결</h1>
        <p>
          연결 토큰과 외부 원문은 화면에 표시하거나 브리프 DB에 저장하지 않습니다.
          브리프를 만들 때만 현재 사용자 권한으로 다시 읽습니다.
        </p>
      </header>

      {message && (
        <Alert tone="warning" className="integration-connections-message">
          {message}
        </Alert>
      )}

      {profileUnavailable && (
        <Alert tone="warning" className="integration-connections-warning">
          아직 활성 연동 프로필이 없습니다. 관리자가 읽기 전용 범위와 허용 대상부터
          설정해야 연결을 시작할 수 있습니다.
        </Alert>
      )}

      <div className="integration-connection-list" aria-busy={isLoading}>
        {providers.map((provider) => {
          const status =
            connectionByProvider.get(provider.id)?.status ??
            "authorization_required";
          const copy = statusCopy[status];
          const isPending = pendingProvider === provider.id;
          const isConnected = status === "connected";

          return (
            <article className="integration-connection-card ds-card" key={provider.id}>
              <div>
                <p className="eyebrow">읽기 전용 · 사용자별</p>
                <h2>{provider.name}</h2>
                <p>{provider.description}</p>
              </div>
              <div className="integration-connection-status">
                <Badge tone={isConnected ? "success" : "warning"}>
                  {copy.label}
                </Badge>
                <StatusIndicator tone={isConnected ? "success" : "warning"}>
                  {isConnected ? "연결 상태 정상" : "사용자 조치 필요"}
                </StatusIndicator>
                <p>{copy.detail}</p>
              </div>
              <div className="button-row">
                <Button
                  type="button"
                  onClick={() => startAuthorization(provider.id)}
                  disabled={isLoading || isPending || profileUnavailable}
                >
                  {isPending ? "처리 중" : isConnected ? "다시 연결" : "연결"}
                </Button>
                {isConnected && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => disconnect(provider.id)}
                    disabled={isPending}
                  >
                    연결 해제
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function safeAuthorizationUrl(value: string): string {
  const url = new URL(value);

  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("OAuth authorization URL is invalid.");
  }

  return url.toString();
}
