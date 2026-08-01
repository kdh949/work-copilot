export type IntegrationProfile = {
  id: string;
  jiraBaseUrl: string;
  confluenceBaseUrl: string;
  jiraClientId: string;
  confluenceClientId: string;
  jiraClientSecretConfigured: boolean;
  confluenceClientSecretConfigured: boolean;
  webhookRouteSecretConfigured: boolean;
  jiraScopes: string[];
  confluenceScopes: string[];
  allowedProjectKeys: string[];
  allowedSpaceKeys: string[];
  briefParentPageId: string | null;
  childTaskIssueTypeId: string | null;
  childTaskTemplateFields: Record<string, ChildTaskTemplateFieldValue>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ChildTaskTemplateFieldValue = string | number | boolean | string[];

export type IntegrationProfileInput = {
  jiraBaseUrl: string;
  confluenceBaseUrl: string;
  jiraClientId: string;
  confluenceClientId: string;
  jiraClientSecret?: string;
  confluenceClientSecret?: string;
  jiraScopes: string[];
  confluenceScopes: string[];
  allowedProjectKeys: string[];
  allowedSpaceKeys: string[];
  briefParentPageId: string;
  childTaskIssueTypeId?: string;
  childTaskTemplateFields?: Record<string, ChildTaskTemplateFieldValue>;
};

type ResourceStatus = "reachable" | "authorization_required" | "unavailable";

export type IntegrationConnectionTest = {
  jira: {
    discovery: "reachable";
    allowedResources: Record<string, ResourceStatus>;
  };
  confluence: {
    discovery: "reachable";
    allowedResources: Record<string, ResourceStatus>;
    parentPage: ResourceStatus | "not_configured";
  };
};

export type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

export type WorkCopilotMetric = {
  name: string;
  labels: Record<string, string | undefined>;
  count: number;
  averageDurationMs?: number;
};

export type WorkCopilotOperationsHealth = {
  webhook: {
    mode: "shadow" | "manual_refresh";
    ingressVerified: boolean;
    allowedCidrCount: number;
    lastReceivedAt: string | null;
    ingressRejectionCount: number;
  };
  cleanup: {
    status: "pending" | "healthy" | "degraded";
    maxAgeSeconds: number;
    jobs: Array<{
      job: "transient_evidence" | "source_change_events";
      status: "pending" | "healthy" | "degraded";
      lastAttemptAt: string | null;
      lastSuccessAt: string | null;
      lastDeletedCount: number;
    }>;
  };
  metrics: WorkCopilotMetric[];
};
