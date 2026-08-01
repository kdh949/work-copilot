import { BadRequestException, Injectable } from '@nestjs/common';
import { IntegrationsOAuthService } from '../../integrations/oauth/integrations-oauth.service';
import { AtlassianReadClientService } from '../atlassian-read-client.service';
import {
  type EvidenceCollectionResponse,
  type NormalizedEvidence,
  normalizeEvidence,
  toTransientPlainText,
} from '../evidence/evidence-normalizer';
import { IntegrationAccessPolicyService } from '../integration-access-policy.service';
import type { IntegrationProfile } from '../../integrations/profiles/entities/integration-profile.entity';

const ISSUE_KEY_PATTERN = /^([A-Z][A-Z0-9_]{0,31})-([1-9][0-9]*)$/;
const MAX_TRANSIENT_EVIDENCE_CHARS = 8_000;

export type TransientJiraDraftEvidence = {
  evidence: NormalizedEvidence;
  content: string;
};

export type JiraDraftContext = {
  accessStatus: EvidenceCollectionResponse['accessStatus'];
  profileId: string | null;
  sourceJiraId: string | null;
  sourceJiraKey: string;
  sourceJiraVersion: string | null;
  evidence: TransientJiraDraftEvidence[];
};

@Injectable()
export class JiraWorkItemService {
  constructor(
    private readonly accessPolicy: IntegrationAccessPolicyService,
    private readonly readClient: AtlassianReadClientService,
    private readonly integrationsOAuthService: IntegrationsOAuthService,
  ) {}

  async collectIssueEvidence(
    userId: number,
    issueKeyValue: string,
    correlationId: string,
  ): Promise<EvidenceCollectionResponse> {
    const context = await this.collectIssueDraftContext(
      userId,
      issueKeyValue,
      correlationId,
    );

    return {
      accessStatus: context.accessStatus,
      evidence: context.evidence.map((item) => item.evidence),
    };
  }

  async collectIssueDraftContext(
    userId: number,
    issueKeyValue: string,
    correlationId: string,
  ): Promise<JiraDraftContext> {
    const issueKey = this.issueKey(issueKeyValue);
    const profile = await this.accessPolicy.activeProfile();
    this.accessPolicy.assertAllowedProject(profile, this.projectKey(issueKey));
    const accessToken = await this.integrationsOAuthService.getAccessToken(
      userId,
      'jira',
      correlationId,
    );
    const root = await this.readIssue(profile, accessToken, issueKey);

    if (root.status !== 'ok') {
      return {
        accessStatus: root.status,
        profileId: null,
        sourceJiraId: null,
        sourceJiraKey: issueKey,
        sourceJiraVersion: null,
        evidence: [],
      };
    }

    const rootEvidence = this.toTransientDraftEvidence(profile, root.body);
    const evidence = [rootEvidence];
    const linkedKeys = this.linkedIssueKeys(root.body);

    for (const linkedKey of linkedKeys) {
      if (!profile.allowedProjectKeys.includes(this.projectKey(linkedKey))) {
        continue;
      }

      const linked = await this.readIssue(profile, accessToken, linkedKey);

      if (linked.status !== 'ok') {
        continue;
      }

      const normalized = this.toTransientDraftEvidence(profile, linked.body);

      if (
        !evidence.some((item) => item.evidence.id === normalized.evidence.id)
      ) {
        evidence.push(normalized);
      }
    }

    return {
      accessStatus: 'accessible',
      profileId: profile.id,
      sourceJiraId: rootEvidence.evidence.sourceId,
      sourceJiraKey: issueKey,
      sourceJiraVersion: rootEvidence.evidence.version,
      evidence,
    };
  }

  private async readIssue(
    profile: IntegrationProfile,
    accessToken: string,
    issueKey: string,
  ) {
    // Jira Data Center REST uses the versioned /rest/api/2 issue resource and
    // supports selecting the minimal field set needed for the evidence record.
    // Source: https://developer.atlassian.com/server/jira/platform/about-the-jira-server-rest-apis/
    const query = new URLSearchParams({
      fields: 'summary,project,updated,description,issuelinks',
    });
    const url = this.accessPolicy.providerUrl(
      profile,
      'jira',
      `rest/api/2/issue/${encodeURIComponent(issueKey)}?${query.toString()}`,
    );

    return this.readClient.getJson(
      url,
      this.accessPolicy.providerBaseUrl(profile, 'jira'),
      accessToken,
    );
  }

  private normalizeIssue(
    profile: IntegrationProfile,
    body: Record<string, unknown>,
  ): NormalizedEvidence {
    const fields = this.record(body.fields, 'Jira issue is invalid.');
    const project = this.record(fields.project, 'Jira issue is invalid.');
    const projectKey = this.string(project.key, 'Jira issue is invalid.');
    this.accessPolicy.assertAllowedProject(profile, projectKey);
    const issueKey = this.issueKey(
      this.string(body.key, 'Jira issue is invalid.'),
    );
    const sourceId = this.identifier(body.id, 'Jira issue is invalid.');
    const title = this.string(fields.summary, 'Jira issue is invalid.');
    const version = this.string(fields.updated, 'Jira issue is invalid.');
    const url = this.accessPolicy.providerUrl(
      profile,
      'jira',
      `browse/${encodeURIComponent(issueKey)}`,
    );

    return normalizeEvidence({
      provider: 'jira',
      sourceId,
      url: url.toString(),
      title,
      version,
      excerptSource: fields.description,
    });
  }

  private toTransientDraftEvidence(
    profile: IntegrationProfile,
    body: Record<string, unknown>,
  ): TransientJiraDraftEvidence {
    const evidence = this.normalizeIssue(profile, body);
    const fields = this.record(body.fields, 'Jira issue is invalid.');
    const description = toTransientPlainText(
      fields.description,
      MAX_TRANSIENT_EVIDENCE_CHARS,
    );
    const content = `${evidence.title}\n${description}`.slice(
      0,
      MAX_TRANSIENT_EVIDENCE_CHARS,
    );

    return { evidence, content };
  }

  private linkedIssueKeys(body: Record<string, unknown>): string[] {
    const fields = this.record(body.fields, 'Jira issue is invalid.');
    const links = Array.isArray(fields.issuelinks) ? fields.issuelinks : [];
    const keys = new Set<string>();

    for (const link of links) {
      if (!this.isRecord(link)) {
        continue;
      }

      for (const direction of ['outwardIssue', 'inwardIssue']) {
        const linkedIssue = link[direction];

        if (
          !this.isRecord(linkedIssue) ||
          typeof linkedIssue.key !== 'string'
        ) {
          continue;
        }

        try {
          keys.add(this.issueKey(linkedIssue.key));
        } catch {
          // Provider link metadata is not trusted as a retrieval target.
        }
      }
    }

    return [...keys];
  }

  private issueKey(value: string): string {
    const normalized = value.trim().toUpperCase();

    if (!ISSUE_KEY_PATTERN.test(normalized)) {
      throw new BadRequestException('Jira issue key is invalid.');
    }

    return normalized;
  }

  private projectKey(issueKey: string): string {
    const match = ISSUE_KEY_PATTERN.exec(issueKey);

    if (!match) {
      throw new BadRequestException('Jira issue key is invalid.');
    }

    return match[1];
  }

  private record(value: unknown, message: string): Record<string, unknown> {
    if (!this.isRecord(value)) {
      throw new BadRequestException(message);
    }

    return value;
  }

  private string(value: unknown, message: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new BadRequestException(message);
    }

    return value;
  }

  private identifier(value: unknown, message: string): string {
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
      return String(value);
    }

    return this.string(value, message);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
