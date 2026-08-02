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
import type {
  ChildTaskTemplate,
  IntegrationProfile,
} from '../../integrations/profiles/entities/integration-profile.entity';

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

export type JiraReadinessEvidenceVersion = {
  id: string;
  version: string;
};

export type JiraReadinessDependency =
  | {
      kind: 'visible_blocker';
      issueKey: string;
      url: string;
      crossProject: boolean;
    }
  | { kind: 'access_limited' };

export type JiraCreateMetadata =
  | { status: 'not_requested'; requiredFieldIds: [] }
  | { status: 'available'; requiredFieldIds: string[] }
  | { status: 'access_limited' | 'not_found'; requiredFieldIds: [] };

export type JiraReadinessContext = {
  accessStatus: EvidenceCollectionResponse['accessStatus'];
  profileId: string | null;
  sourceJiraId: string | null;
  sourceJiraKey: string;
  sourceJiraVersion: string | null;
  evidenceVersions: JiraReadinessEvidenceVersion[];
  hasAccessLimitedEvidence: boolean;
  dependencies: JiraReadinessDependency[];
  childTaskTemplate: ChildTaskTemplate | null;
  createMetadata: JiraCreateMetadata;
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

  async collectReadinessContext(
    userId: number,
    issueKeyValue: string,
    correlationId: string,
    inspectCreateMetadata: boolean,
  ): Promise<JiraReadinessContext> {
    const issueKey = this.issueKey(issueKeyValue);
    const profile = await this.accessPolicy.activeProfile();
    this.accessPolicy.assertAllowedProject(profile, this.projectKey(issueKey));
    const accessToken = await this.integrationsOAuthService.getAccessToken(
      userId,
      'jira',
      correlationId,
    );
    const root = await this.readReadinessIssue(profile, accessToken, issueKey);
    const childTaskTemplate = profile.policy.childTaskTemplate ?? null;

    if (root.status !== 'ok') {
      return {
        accessStatus: root.status,
        profileId: null,
        sourceJiraId: null,
        sourceJiraKey: issueKey,
        sourceJiraVersion: null,
        evidenceVersions: [],
        hasAccessLimitedEvidence: false,
        dependencies: [],
        childTaskTemplate,
        createMetadata: { status: 'not_requested', requiredFieldIds: [] },
      };
    }

    const rootIssue = this.toReadinessIssue(profile, root.body);
    const evidenceVersions: JiraReadinessEvidenceVersion[] = [
      { id: `jira:${rootIssue.sourceId}`, version: rootIssue.version },
    ];
    const linkedIssues = this.readinessLinkedIssues(root.body);
    const visibleBlockers: JiraReadinessDependency[] = [];
    let hasAccessLimitedDependency = false;
    let hasAccessLimitedEvidence = false;

    for (const [linkedKey, link] of linkedIssues) {
      try {
        this.accessPolicy.assertAllowedProject(
          profile,
          this.projectKey(linkedKey),
        );
      } catch {
        hasAccessLimitedDependency ||= link.blocksSource;
        continue;
      }

      const linked = await this.readReadinessIssue(
        profile,
        accessToken,
        linkedKey,
      );
      if (linked.status !== 'ok') {
        hasAccessLimitedEvidence = true;
        hasAccessLimitedDependency ||= link.blocksSource;
        continue;
      }

      let linkedIssue: ReturnType<typeof this.toReadinessIssue>;
      try {
        linkedIssue = this.toReadinessIssue(profile, linked.body);
      } catch {
        hasAccessLimitedEvidence = true;
        hasAccessLimitedDependency ||= link.blocksSource;
        continue;
      }
      evidenceVersions.push({
        id: `jira:${linkedIssue.sourceId}`,
        version: linkedIssue.version,
      });

      if (link.blocksSource && !linkedIssue.resolved) {
        visibleBlockers.push({
          kind: 'visible_blocker',
          issueKey: linkedIssue.issueKey,
          url: linkedIssue.url,
          crossProject: linkedIssue.projectKey !== rootIssue.projectKey,
        });
      }
    }

    const createMetadata =
      inspectCreateMetadata && childTaskTemplate
        ? await this.readCreateMetadata(
            profile,
            accessToken,
            rootIssue.projectKey,
            childTaskTemplate.issueTypeId,
          )
        : { status: 'not_requested' as const, requiredFieldIds: [] as [] };

    return {
      accessStatus: 'accessible',
      profileId: profile.id,
      sourceJiraId: rootIssue.sourceId,
      sourceJiraKey: rootIssue.issueKey,
      sourceJiraVersion: rootIssue.version,
      evidenceVersions,
      hasAccessLimitedEvidence,
      dependencies: hasAccessLimitedDependency
        ? [...visibleBlockers, { kind: 'access_limited' }]
        : visibleBlockers,
      childTaskTemplate,
      createMetadata,
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

  private async readReadinessIssue(
    profile: IntegrationProfile,
    accessToken: string,
    issueKey: string,
  ) {
    const query = new URLSearchParams({
      fields: 'project,updated,status,resolution,issuelinks',
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

  private async readCreateMetadata(
    profile: IntegrationProfile,
    accessToken: string,
    projectKey: string,
    issueTypeId: string,
  ): Promise<JiraCreateMetadata> {
    const query = new URLSearchParams({
      projectKeys: projectKey,
      issuetypeIds: issueTypeId,
      expand: 'projects.issuetypes.fields',
    });
    const url = this.accessPolicy.providerUrl(
      profile,
      'jira',
      `rest/api/2/issue/createmeta?${query.toString()}`,
    );
    const result = await this.readClient.getJson(
      url,
      this.accessPolicy.providerBaseUrl(profile, 'jira'),
      accessToken,
    );

    if (result.status !== 'ok') {
      return { status: result.status, requiredFieldIds: [] };
    }

    return {
      status: 'available',
      requiredFieldIds: this.requiredCreateFieldIds(
        result.body,
        projectKey,
        issueTypeId,
      ),
    };
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

  private toReadinessIssue(
    profile: IntegrationProfile,
    body: Record<string, unknown>,
  ): {
    sourceId: string;
    issueKey: string;
    projectKey: string;
    version: string;
    url: string;
    resolved: boolean;
  } {
    const fields = this.record(body.fields, 'Jira issue is invalid.');
    const project = this.record(fields.project, 'Jira issue is invalid.');
    const projectKey = this.string(project.key, 'Jira issue is invalid.');
    this.accessPolicy.assertAllowedProject(profile, projectKey);
    const issueKey = this.issueKey(
      this.string(body.key, 'Jira issue is invalid.'),
    );
    const sourceId = this.identifier(body.id, 'Jira issue is invalid.');
    const version = this.string(fields.updated, 'Jira issue is invalid.');
    const url = this.accessPolicy.providerUrl(
      profile,
      'jira',
      `browse/${encodeURIComponent(issueKey)}`,
    );

    return {
      sourceId,
      issueKey,
      projectKey,
      version,
      url: url.toString(),
      resolved: this.isResolved(fields),
    };
  }

  private requiredCreateFieldIds(
    body: Record<string, unknown>,
    projectKey: string,
    issueTypeId: string,
  ): string[] {
    let project: Record<string, unknown> | undefined;
    for (const candidate of this.unknownArray(body.projects)) {
      if (
        this.isRecord(candidate) &&
        typeof candidate.key === 'string' &&
        candidate.key.toUpperCase() === projectKey
      ) {
        project = candidate;
        break;
      }
    }
    if (!project) {
      throw new BadRequestException('Jira create metadata is invalid.');
    }

    let issueType: Record<string, unknown> | undefined;
    for (const candidate of this.unknownArray(project.issuetypes)) {
      if (
        this.isRecord(candidate) &&
        (typeof candidate.id === 'string' ||
          typeof candidate.id === 'number') &&
        String(candidate.id) === issueTypeId
      ) {
        issueType = candidate;
        break;
      }
    }
    if (!issueType) {
      throw new BadRequestException('Jira create metadata is invalid.');
    }

    const fields = this.record(
      issueType.fields,
      'Jira create metadata is invalid.',
    );
    return Object.entries(fields)
      .filter(([, value]) => this.isRecord(value) && value.required === true)
      .map(([fieldId]) => fieldId)
      .sort();
  }

  private readinessLinkedIssues(
    body: Record<string, unknown>,
  ): Map<string, { blocksSource: boolean }> {
    const fields = this.record(body.fields, 'Jira issue is invalid.');
    const links = Array.isArray(fields.issuelinks) ? fields.issuelinks : [];
    const linked = new Map<string, { blocksSource: boolean }>();

    for (const link of links) {
      if (!this.isRecord(link)) {
        continue;
      }
      const type = this.isRecord(link.type) ? link.type : {};

      for (const direction of ['outwardIssue', 'inwardIssue'] as const) {
        const issue = link[direction];
        if (!this.isRecord(issue) || typeof issue.key !== 'string') {
          continue;
        }

        try {
          const key = this.issueKey(issue.key);
          const previous = linked.get(key);
          linked.set(key, {
            blocksSource:
              (previous?.blocksSource ?? false) ||
              this.blocksSource(direction, type),
          });
        } catch {
          // Untrusted provider link metadata is never returned or persisted.
        }
      }
    }

    return linked;
  }

  private blocksSource(
    direction: 'outwardIssue' | 'inwardIssue',
    type: Record<string, unknown>,
  ): boolean {
    const relation = direction === 'inwardIssue' ? type.inward : type.outward;
    const relationText =
      typeof relation === 'string' ? relation.trim().toLowerCase() : '';
    const typeName =
      typeof type.name === 'string' ? type.name.trim().toLowerCase() : '';

    return (
      /(?:^|\s)(?:is\s+)?blocked\s+by(?:\s|$)/.test(relationText) ||
      (direction === 'inwardIssue' && /block/.test(typeName))
    );
  }

  private isResolved(fields: Record<string, unknown>): boolean {
    if (fields.resolution !== null && fields.resolution !== undefined) {
      return true;
    }

    const status = this.isRecord(fields.status) ? fields.status : null;
    const category =
      status && this.isRecord(status.statusCategory)
        ? status.statusCategory
        : null;
    return category?.key === 'done';
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

  private unknownArray(value: unknown): unknown[] {
    return Array.isArray(value) ? (value as unknown[]) : [];
  }
}
