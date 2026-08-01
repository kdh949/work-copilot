export type IntegrationProfile = {
  id: string;
  jiraBaseUrl: string;
  confluenceBaseUrl: string;
  jiraClientId: string;
  confluenceClientId: string;
  jiraClientSecretConfigured: boolean;
  confluenceClientSecretConfigured: boolean;
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
