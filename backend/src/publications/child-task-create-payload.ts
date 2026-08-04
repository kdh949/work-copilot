import type {
  ChildTaskTemplate,
  ChildTaskTemplateFieldValue,
} from '../integrations/profiles/entities/integration-profile.entity';
import type { BriefChildTask } from '../work-briefs/brief-draft.types';

export type CanonicalChildTaskCreatePayload = {
  project: { key: string };
  issueType: { id: string };
  parent: { id: string; key: string };
  fields: Record<string, ChildTaskTemplateFieldValue | object>;
};

export function projectKeyFromIssueKey(issueKey: string): string | null {
  const match = /^([A-Za-z][A-Za-z0-9_]*)-\d+$/.exec(issueKey.trim());
  return match ? match[1].toUpperCase() : null;
}

export function normalizeJiraSummary(value: string, maxLength = 512): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * Shared by preview and provider write so the approved payload is exactly the
 * object sent to Jira's issue-create endpoint.
 */
export function buildChildTaskCreatePayload(input: {
  sourceJiraId: string;
  sourceJiraKey: string;
  childTask: BriefChildTask;
  template: ChildTaskTemplate;
}): CanonicalChildTaskCreatePayload | null {
  const projectKey = projectKeyFromIssueKey(input.sourceJiraKey);
  if (!projectKey) {
    return null;
  }
  const project = { key: projectKey };
  const issueType = { id: input.template.issueTypeId };
  const parent = { id: input.sourceJiraId, key: input.sourceJiraKey };
  return {
    project,
    issueType,
    parent,
    fields: {
      ...input.template.fields,
      project,
      issuetype: issueType,
      parent: { id: input.sourceJiraId },
      summary: normalizeJiraSummary(input.childTask.summary),
    },
  };
}
