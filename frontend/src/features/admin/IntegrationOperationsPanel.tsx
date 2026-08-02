import type { WorkCopilotOperationsHealth } from "./integration-profile.types";

type IntegrationOperationsPanelProps = {
  health: WorkCopilotOperationsHealth;
};

const timeLabel = (value: string | null): string =>
  value
    ? new Date(value).toLocaleString("ko-KR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "아직 수신 없음";

const cleanupStatusLabel = (value: "pending" | "healthy" | "degraded") =>
  value === "healthy" ? "정상" : value === "pending" ? "대기" : "점검 필요";

const metricCount = (
  health: WorkCopilotOperationsHealth,
  name: string,
  outcome: string,
): number =>
  health.metrics
    .filter(
      (metric) => metric.name === name && metric.labels.outcome === outcome,
    )
    .reduce((total, metric) => total + metric.count, 0);

export function IntegrationOperationsPanel({
  health,
}: IntegrationOperationsPanelProps) {
  const shadowMode = health.webhook.mode === "shadow";

  return (
    <section
      className="integration-operations"
      aria-labelledby="operations-title"
    >
      <div className="integration-operations-heading">
        <div>
          <p className="eyebrow">파일럿 운영 상태</p>
          <h2 id="operations-title">Webhook · TTL 정리 상태</h2>
        </div>
        <span className={`status ${shadowMode ? "active" : ""}`}>
          {shadowMode ? "Shadow mode" : "수동 새로 고침"}
        </span>
      </div>

      {!shadowMode && (
        <p className="operation-warning" role="status">
          ingress 경계가 아직 검증되지 않아 webhook은 저장·전이하지 않습니다.
          사용자 새로 고침으로만 최신성을 확인하세요.
        </p>
      )}

      <dl className="integration-operation-details">
        <div>
          <dt>마지막 안전 메타데이터 수신</dt>
          <dd>{timeLabel(health.webhook.lastReceivedAt)}</dd>
        </div>
        <div>
          <dt>검증된 허용 CIDR</dt>
          <dd>{health.webhook.allowedCidrCount}개</dd>
        </div>
        <div>
          <dt>이 인스턴스의 ingress 거절</dt>
          <dd>{health.webhook.ingressRejectionCount}건</dd>
        </div>
        <div>
          <dt>shadow 수신</dt>
          <dd>{metricCount(health, "webhook_intake_total", "accepted")}건</dd>
        </div>
      </dl>

      <div className="integration-cleanup-list">
        {health.cleanup.jobs.map((job) => (
          <div key={job.job}>
            <strong>
              {job.job === "transient_evidence"
                ? "암호화 발췌 TTL"
                : "변경 이벤트 TTL"}
            </strong>
            <span>{cleanupStatusLabel(job.status)}</span>
            <small>
              마지막 성공: {timeLabel(job.lastSuccessAt)} · 최근 삭제:{" "}
              {job.lastDeletedCount}건
            </small>
          </div>
        ))}
      </div>
    </section>
  );
}
