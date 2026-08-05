export type IntegrationProvider = "jira" | "confluence";

export type ConnectionStatus =
  | "connected"
  | "expired"
  | "reauthorization_required"
  | "authorization_required";

export type IntegrationConnection = {
  provider: IntegrationProvider;
  status: ConnectionStatus;
};

export const providerLabel: Record<IntegrationProvider, string> = {
  jira: "Jira",
  confluence: "Confluence",
};

export const statusCopy: Record<
  ConnectionStatus,
  { label: string; detail: string }
> = {
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

export function connectionTone(
  status: ConnectionStatus,
): "success" | "warning" {
  return status === "connected" ? "success" : "warning";
}
