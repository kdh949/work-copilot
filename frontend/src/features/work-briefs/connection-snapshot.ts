import type {
  ConnectionStatus,
  IntegrationConnection,
  IntegrationProvider,
} from "../integrations/connection-status";

export type ConnectionSnapshot =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "ready"; byProvider: Record<IntegrationProvider, ConnectionStatus> };

export const PROVIDER_ORDER: IntegrationProvider[] = ["jira", "confluence"];

export function toConnectionSnapshot(
  loaded: IntegrationConnection[],
): ConnectionSnapshot {
  if (!Array.isArray(loaded)) return { state: "unavailable" };
  const statusOf = (provider: IntegrationProvider): ConnectionStatus =>
    loaded.find((connection) => connection.provider === provider)?.status ??
    "authorization_required";
  return {
    state: "ready",
    byProvider: { jira: statusOf("jira"), confluence: statusOf("confluence") },
  };
}

export function connectionsNeedingAction(
  snapshot: ConnectionSnapshot,
): IntegrationProvider[] {
  if (snapshot.state !== "ready") return [];
  return PROVIDER_ORDER.filter(
    (provider) => snapshot.byProvider[provider] !== "connected",
  );
}
