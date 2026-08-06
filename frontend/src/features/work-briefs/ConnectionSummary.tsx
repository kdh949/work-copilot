import { StatusIndicator } from "../../design-system/components";
import {
  connectionTone,
  providerLabel,
  statusCopy,
} from "../integrations/connection-status";
import { PROVIDER_ORDER, type ConnectionSnapshot } from "./connection-snapshot";

export function ConnectionSummary({
  snapshot,
  onOpenIntegrations,
}: {
  snapshot: ConnectionSnapshot;
  onOpenIntegrations?: () => void;
}) {
  return (
    <section className="work-brief-connection">
      <h3 className="sr-only">Jira · Confluence 연결 상태</h3>
      {snapshot.state === "ready" ? (
        <ul className="work-brief-connection-list">
          {PROVIDER_ORDER.map((provider) => {
            const status = snapshot.byProvider[provider];
            return (
              <li key={provider}>
                <StatusIndicator tone={connectionTone(status)}>
                  {providerLabel[provider]} · {statusCopy[status].label}
                </StatusIndicator>
              </li>
            );
          })}
        </ul>
      ) : (
        <StatusIndicator tone="neutral">
          {snapshot.state === "loading"
            ? "연결 상태 확인 중"
            : "연결 상태를 확인할 수 없습니다"}
        </StatusIndicator>
      )}
      <button type="button" onClick={onOpenIntegrations}>
        연동 설정
      </button>
    </section>
  );
}
