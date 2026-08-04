import { Injectable } from '@nestjs/common';
import { IntegrationsOAuthService } from '../integrations/oauth/integrations-oauth.service';
import type {
  ChildTaskTemplate,
  IntegrationProfile,
} from '../integrations/profiles/entities/integration-profile.entity';
import { AtlassianReadClientService } from '../work-items/atlassian-read-client.service';
import { AtlassianWriteClientService } from '../work-items/atlassian-write-client.service';
import { IntegrationAccessPolicyService } from '../work-items/integration-access-policy.service';
import type {
  BriefChildTask,
  BriefContent,
  StoredBriefEvidence,
} from '../work-briefs/brief-draft.types';
import {
  PublicationGatewayError,
  type PublicationWriteGateway,
  type PublicationWriteResult,
} from './publication-write-gateway';
import { PublicationRendererService } from './publication-renderer.service';
import {
  buildChildTaskCreatePayload,
  normalizeJiraSummary,
} from './child-task-create-payload';
import { confluencePublicationTitle } from './confluence-publication-title';

const JIRA_CHILD_PROPERTY_KEY = 'work-copilot.publication-task';
const RECONCILIATION_PAGE_SIZE = 50;
const MAX_RECONCILIATION_PAGES = 5;
const MAX_RECONCILIATION_REQUESTS = 30;
const MAX_RECONCILIATION_PROPERTY_LOOKUPS =
  MAX_RECONCILIATION_REQUESTS - MAX_RECONCILIATION_PAGES;

type GatewayContext = {
  userId: number;
  correlationId: string;
  profile: IntegrationProfile;
};

type ConfluencePage = {
  id: string;
  version: string;
  url: string;
};

/**
 * Real, user-context-only publication adapter for Jira and Confluence Data
 * Center. It intentionally persists no provider response body and uses a
 * deterministic Confluence title plus Jira markers for reconciliation after
 * an ambiguous network failure.
 */
@Injectable()
export class AtlassianPublicationWriteGateway implements PublicationWriteGateway {
  readonly mode = 'real' as const;

  constructor(
    private readonly oauth: IntegrationsOAuthService,
    private readonly accessPolicy: IntegrationAccessPolicyService,
    private readonly readClient: AtlassianReadClientService,
    private readonly writeClient: AtlassianWriteClientService,
    private readonly renderer: PublicationRendererService,
  ) {}

  async upsertConfluenceBrief(
    input: GatewayContext & {
      operationId: string;
      parentPageId: string;
      existingContentId: string | null;
      draftId: string;
      sourceJiraKey: string;
      content: BriefContent;
      evidence: StoredBriefEvidence[];
    },
  ): Promise<PublicationWriteResult> {
    const rendered = this.renderer.render(
      input.sourceJiraKey,
      input.content,
      input.evidence,
    );
    const pageTitle = confluencePublicationTitle(
      rendered.pageTitle,
      input.draftId,
      rendered.contentHash,
    );
    const accessToken = await this.token(input, 'confluence');

    if (input.existingContentId) {
      const existing = await this.readConfluencePage(
        input.profile,
        accessToken,
        input.existingContentId,
      );
      if (!existing) {
        this.fail('CONFLUENCE_VERSION_CONFLICT', false);
      }
      return {
        providerObjectId: existing.id,
        providerObjectVersion: existing.version,
        providerUrl: existing.url,
        contentHash: rendered.contentHash,
      };
    }

    const parent = await this.readConfluenceParent(
      input.profile,
      accessToken,
      input.parentPageId,
    );
    const reconciled = await this.findConfluencePageByTitle(
      input.profile,
      accessToken,
      parent.id,
      pageTitle,
    );
    if (reconciled) {
      return {
        providerObjectId: reconciled.id,
        providerObjectVersion: reconciled.version,
        providerUrl: reconciled.url,
        contentHash: rendered.contentHash,
      };
    }

    const created = await this.writeClient.postJson(
      this.accessPolicy.providerUrl(
        input.profile,
        'confluence',
        'rest/api/content',
      ),
      this.accessPolicy.providerBaseUrl(input.profile, 'confluence'),
      accessToken,
      {
        type: 'page',
        title: pageTitle,
        space: { key: parent.spaceKey },
        ancestors: [{ id: parent.id }],
        body: {
          storage: {
            value: rendered.storageBody,
            representation: 'storage',
          },
        },
      },
    );
    if (created.status !== 'ok') {
      const recovered = await this.findConfluencePageByTitle(
        input.profile,
        accessToken,
        parent.id,
        pageTitle,
      );
      if (recovered) {
        return {
          providerObjectId: recovered.id,
          providerObjectVersion: recovered.version,
          providerUrl: recovered.url,
          contentHash: rendered.contentHash,
        };
      }
      if (created.status === 'conflict') {
        this.fail('CONFLUENCE_VERSION_CONFLICT', false);
      }
      this.fail('CONFLUENCE_WRITE_FAILED', created.status === 'rejected');
    }

    const page = this.confluencePage(input.profile, created.body);
    return {
      providerObjectId: page.id,
      providerObjectVersion: page.version,
      providerUrl: page.url,
      contentHash: rendered.contentHash,
    };
  }

  async upsertJiraRemoteLink(
    input: GatewayContext & {
      operationId: string;
      sourceJiraId: string;
      confluenceContentId: string;
      confluenceUrl: string | null;
      confluenceTitle: string;
    },
  ): Promise<PublicationWriteResult> {
    const accessToken = await this.token(input, 'jira');
    const globalId = this.remoteLinkGlobalId(input.operationId);
    const linkUrl =
      input.confluenceUrl ??
      this.confluencePageUrl(input.profile, input.confluenceContentId);
    const endpoint = this.accessPolicy.providerUrl(
      input.profile,
      'jira',
      `rest/api/2/issue/${encodeURIComponent(input.sourceJiraId)}/remotelink?globalId=${encodeURIComponent(globalId)}`,
    );
    const existing = await this.readClient.getJson(
      endpoint,
      this.accessPolicy.providerBaseUrl(input.profile, 'jira'),
      accessToken,
    );
    if (existing.status === 'ok') {
      const existingId = this.identifier(existing.body.id);
      if (existingId) {
        return { providerObjectId: existingId, providerUrl: linkUrl };
      }
    }
    if (existing.status === 'access_limited') {
      this.fail('JIRA_REMOTE_LINK_FAILED', false);
    }

    const created = await this.writeClient.postJson(
      this.accessPolicy.providerUrl(
        input.profile,
        'jira',
        `rest/api/2/issue/${encodeURIComponent(input.sourceJiraId)}/remotelink`,
      ),
      this.accessPolicy.providerBaseUrl(input.profile, 'jira'),
      accessToken,
      {
        globalId,
        application: {
          type: 'com.dh.work-copilot',
          name: 'Work Copilot',
        },
        relationship: 'documents',
        object: {
          url: linkUrl,
          title: this.plainText(input.confluenceTitle, 255),
        },
      },
    );
    if (created.status !== 'ok') {
      const reconciled = await this.readClient.getJson(
        endpoint,
        this.accessPolicy.providerBaseUrl(input.profile, 'jira'),
        accessToken,
      );
      if (reconciled.status === 'ok') {
        const existingId = this.identifier(reconciled.body.id);
        if (existingId) {
          return { providerObjectId: existingId, providerUrl: linkUrl };
        }
      }
      this.fail('JIRA_REMOTE_LINK_FAILED', created.status === 'rejected');
    }

    const id = this.identifier(created.body.id);
    if (!id) {
      this.fail('JIRA_REMOTE_LINK_FAILED', false);
    }
    return { providerObjectId: id, providerUrl: linkUrl };
  }

  async createJiraSummaryComment(
    input: GatewayContext & {
      operationId: string;
      sourceJiraId: string;
      summary: string;
      confluenceContentId: string;
      confluenceUrl: string | null;
    },
  ): Promise<PublicationWriteResult> {
    const accessToken = await this.token(input, 'jira');
    const marker = this.commentMarker(input.operationId);
    const endpoint = this.accessPolicy.providerUrl(
      input.profile,
      'jira',
      `rest/api/2/issue/${encodeURIComponent(input.sourceJiraId)}/comment`,
    );
    const existing = await this.findCommentByMarker(
      endpoint,
      input.profile,
      accessToken,
      marker,
    );
    if (existing) {
      return { providerObjectId: existing };
    }

    const pageUrl =
      input.confluenceUrl ??
      this.confluencePageUrl(input.profile, input.confluenceContentId);
    const created = await this.writeClient.postJson(
      this.accessPolicy.providerUrl(
        input.profile,
        'jira',
        `rest/api/2/issue/${encodeURIComponent(input.sourceJiraId)}/comment`,
      ),
      this.accessPolicy.providerBaseUrl(input.profile, 'jira'),
      accessToken,
      {
        body: `${this.escapeJiraWiki(input.summary)}\n\nConfluence: ${pageUrl}\n${marker}`,
      },
    );
    if (created.status !== 'ok') {
      const reconciled = await this.findCommentByMarker(
        endpoint,
        input.profile,
        accessToken,
        marker,
      );
      if (reconciled) {
        return { providerObjectId: reconciled };
      }
      this.fail('JIRA_SUMMARY_COMMENT_FAILED', created.status === 'rejected');
    }
    const id = this.identifier(created.body.id);
    if (!id) {
      this.fail('JIRA_SUMMARY_COMMENT_FAILED', false);
    }
    return { providerObjectId: id };
  }

  async createJiraChildTask(
    input: GatewayContext & {
      operationId: string;
      sourceJiraId: string;
      sourceJiraKey: string;
      childTask: BriefChildTask;
      template: ChildTaskTemplate;
    },
  ): Promise<PublicationWriteResult> {
    const accessToken = await this.token(input, 'jira');
    const existing = await this.findChildTaskByOperation(
      input.profile,
      accessToken,
      input.sourceJiraKey,
      input.operationId,
      input.childTask.clientTaskId,
    );
    if (existing) {
      return { providerObjectId: existing };
    }

    const payload = buildChildTaskCreatePayload({
      sourceJiraId: input.sourceJiraId,
      sourceJiraKey: input.sourceJiraKey,
      childTask: input.childTask,
      template: input.template,
    });
    if (!payload) {
      this.fail('JIRA_CHILD_TASK_FAILED', false);
    }
    this.accessPolicy.assertAllowedProject(input.profile, payload.project.key);
    const created = await this.writeClient.postJson(
      this.accessPolicy.providerUrl(input.profile, 'jira', 'rest/api/2/issue'),
      this.accessPolicy.providerBaseUrl(input.profile, 'jira'),
      accessToken,
      {
        fields: payload.fields,
        // Jira creates entity properties with the issue in this request. That
        // makes the provider marker atomic with child-task creation.
        properties: [
          {
            key: JIRA_CHILD_PROPERTY_KEY,
            value: {
              operationId: input.operationId,
              clientTaskId: input.childTask.clientTaskId,
            },
          },
        ],
      },
    );
    if (created.status !== 'ok') {
      const reconciled = await this.findChildTaskByOperation(
        input.profile,
        accessToken,
        input.sourceJiraKey,
        input.operationId,
        input.childTask.clientTaskId,
      );
      if (reconciled) {
        return { providerObjectId: reconciled };
      }
      this.fail('JIRA_CHILD_TASK_FAILED', created.status === 'rejected');
    }

    const createdId = this.identifier(created.body.id);
    if (!createdId) {
      this.fail('JIRA_CHILD_TASK_FAILED', false);
    }
    return { providerObjectId: createdId };
  }

  private async token(
    input: GatewayContext,
    provider: 'jira' | 'confluence',
  ): Promise<string> {
    return this.oauth.getAccessToken(
      input.userId,
      provider,
      input.correlationId,
      { requiredScopes: ['WRITE'] },
    );
  }

  private async readConfluenceParent(
    profile: IntegrationProfile,
    accessToken: string,
    parentPageId: string,
  ): Promise<{ id: string; spaceKey: string }> {
    const result = await this.readClient.getJson(
      this.accessPolicy.providerUrl(
        profile,
        'confluence',
        `rest/api/content/${encodeURIComponent(parentPageId)}?expand=space,version`,
      ),
      this.accessPolicy.providerBaseUrl(profile, 'confluence'),
      accessToken,
    );
    if (result.status !== 'ok') {
      this.fail('CONFLUENCE_WRITE_FAILED', false);
    }
    const id = this.identifier(result.body.id);
    const space = this.record(result.body.space);
    const spaceKey = typeof space?.key === 'string' ? space.key.trim() : '';
    if (!id || !spaceKey) {
      this.fail('CONFLUENCE_WRITE_FAILED', false);
    }
    try {
      this.accessPolicy.assertAllowedSpace(profile, spaceKey);
    } catch {
      this.fail('CONFLUENCE_WRITE_FAILED', false);
    }
    return { id, spaceKey };
  }

  private async readConfluencePage(
    profile: IntegrationProfile,
    accessToken: string,
    pageId: string,
  ): Promise<ConfluencePage | null> {
    const result = await this.readClient.getJson(
      this.accessPolicy.providerUrl(
        profile,
        'confluence',
        `rest/api/content/${encodeURIComponent(pageId)}?expand=space,version`,
      ),
      this.accessPolicy.providerBaseUrl(profile, 'confluence'),
      accessToken,
    );
    return result.status === 'ok'
      ? this.confluencePage(profile, result.body)
      : null;
  }

  private async findConfluencePageByTitle(
    profile: IntegrationProfile,
    accessToken: string,
    parentPageId: string,
    expectedTitle: string,
  ): Promise<ConfluencePage | null> {
    let start = 0;
    for (
      let pageIndex = 0;
      pageIndex < MAX_RECONCILIATION_PAGES;
      pageIndex += 1
    ) {
      const children = await this.readClient.getJson(
        this.accessPolicy.providerUrl(
          profile,
          'confluence',
          `rest/api/content/${encodeURIComponent(parentPageId)}/child/page?expand=version&limit=${RECONCILIATION_PAGE_SIZE}&start=${start}`,
        ),
        this.accessPolicy.providerBaseUrl(profile, 'confluence'),
        accessToken,
      );
      if (children.status !== 'ok') {
        return null;
      }
      const items = Array.isArray(children.body.results)
        ? children.body.results
        : [];
      for (const item of items) {
        const candidate = this.record(item);
        if (!candidate || candidate.title !== expectedTitle) {
          continue;
        }
        return this.confluencePage(profile, candidate);
      }
      if (!this.hasNextPage(children.body, start, items.length)) {
        return null;
      }
      start += items.length;
    }
    return null;
  }

  private async findCommentByMarker(
    endpoint: URL,
    profile: IntegrationProfile,
    accessToken: string,
    marker: string,
  ): Promise<string | null> {
    let startAt = 0;
    for (
      let pageIndex = 0;
      pageIndex < MAX_RECONCILIATION_PAGES;
      pageIndex += 1
    ) {
      const page = new URL(endpoint);
      page.searchParams.set('startAt', String(startAt));
      page.searchParams.set('maxResults', String(RECONCILIATION_PAGE_SIZE));
      const result = await this.readClient.getJson(
        page,
        this.accessPolicy.providerBaseUrl(profile, 'jira'),
        accessToken,
      );
      if (result.status !== 'ok' || !Array.isArray(result.body.comments)) {
        return null;
      }
      for (const comment of result.body.comments) {
        const candidate = this.record(comment);
        if (
          candidate &&
          typeof candidate.body === 'string' &&
          candidate.body.includes(marker)
        ) {
          const id = this.identifier(candidate.id);
          if (id) {
            return id;
          }
        }
      }
      if (
        !this.hasNextPage(result.body, startAt, result.body.comments.length)
      ) {
        return null;
      }
      startAt += result.body.comments.length;
    }
    return null;
  }

  private async findChildTaskByOperation(
    profile: IntegrationProfile,
    accessToken: string,
    parentIssueKey: string,
    operationId: string,
    clientTaskId: string,
  ): Promise<string | null> {
    let startAt = 0;
    let propertyLookups = 0;
    for (
      let pageIndex = 0;
      pageIndex < MAX_RECONCILIATION_PAGES;
      pageIndex += 1
    ) {
      const query = new URLSearchParams({
        jql: `parent = ${parentIssueKey}`,
        fields: 'summary',
        properties: JIRA_CHILD_PROPERTY_KEY,
        maxResults: String(RECONCILIATION_PAGE_SIZE),
        startAt: String(startAt),
      });
      const search = await this.readClient.getJson(
        this.accessPolicy.providerUrl(
          profile,
          'jira',
          `rest/api/2/search?${query.toString()}`,
        ),
        this.accessPolicy.providerBaseUrl(profile, 'jira'),
        accessToken,
      );
      if (search.status !== 'ok' || !Array.isArray(search.body.issues)) {
        return null;
      }
      for (const issue of search.body.issues) {
        const candidate = this.record(issue);
        const issueId = candidate ? this.identifier(candidate.id) : null;
        if (!candidate || !issueId) {
          continue;
        }
        const inlineValue = this.issuePropertyValue(
          candidate,
          JIRA_CHILD_PROPERTY_KEY,
        );
        if (
          inlineValue?.operationId === operationId &&
          inlineValue.clientTaskId === clientTaskId
        ) {
          return issueId;
        }
        if (
          inlineValue !== null ||
          propertyLookups >= MAX_RECONCILIATION_PROPERTY_LOOKUPS
        ) {
          continue;
        }
        propertyLookups += 1;
        const property = await this.readClient.getJson(
          this.accessPolicy.providerUrl(
            profile,
            'jira',
            `rest/api/2/issue/${encodeURIComponent(issueId)}/properties/${JIRA_CHILD_PROPERTY_KEY}`,
          ),
          this.accessPolicy.providerBaseUrl(profile, 'jira'),
          accessToken,
        );
        const value =
          property.status === 'ok' ? this.record(property.body.value) : null;
        if (
          value?.operationId === operationId &&
          value.clientTaskId === clientTaskId
        ) {
          return issueId;
        }
      }
      if (!this.hasNextPage(search.body, startAt, search.body.issues.length)) {
        return null;
      }
      startAt += search.body.issues.length;
    }
    return null;
  }

  private hasNextPage(
    body: Record<string, unknown>,
    start: number,
    received: number,
  ): boolean {
    if (received === 0) {
      return false;
    }
    if (typeof body.total === 'number') {
      return start + received < body.total;
    }
    if (typeof body.isLast === 'boolean') {
      return !body.isLast;
    }
    const links = this.record(body._links);
    if (typeof links?.next === 'string' && links.next.trim()) {
      return true;
    }
    return received >= RECONCILIATION_PAGE_SIZE;
  }

  private issuePropertyValue(
    issue: Record<string, unknown>,
    propertyKey: string,
  ): Record<string, unknown> | null {
    const properties = issue.properties;
    if (Array.isArray(properties)) {
      for (const property of properties) {
        const candidate = this.record(property);
        if (candidate?.key === propertyKey) {
          return this.record(candidate.value);
        }
      }
      return null;
    }
    const record = this.record(properties);
    if (!record) {
      return null;
    }
    const direct = this.record(record[propertyKey]);
    if (direct) {
      return this.record(direct.value) ?? direct;
    }
    for (const property of Object.values(record)) {
      const candidate = this.record(property);
      if (candidate?.key === propertyKey) {
        return this.record(candidate.value);
      }
    }
    return null;
  }

  private confluencePage(
    profile: IntegrationProfile,
    body: Record<string, unknown>,
  ): ConfluencePage {
    const id = this.identifier(body.id);
    const version = this.version(body.version);
    if (!id || !version) {
      this.fail('CONFLUENCE_WRITE_FAILED', false);
    }
    return {
      id,
      version,
      url: this.confluencePageUrl(profile, id),
    };
  }

  private confluencePageUrl(
    profile: IntegrationProfile,
    pageId: string,
  ): string {
    return this.accessPolicy
      .providerUrl(
        profile,
        'confluence',
        `pages/viewpage.action?pageId=${encodeURIComponent(pageId)}`,
      )
      .toString();
  }

  private remoteLinkGlobalId(operationId: string): string {
    return `work-copilot:publication:${operationId}`;
  }

  private commentMarker(operationId: string): string {
    return `[work-copilot-operation:${operationId}]`;
  }

  private plainText(value: string, maxLength: number): string {
    return value
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  private escapeJiraWiki(value: string): string {
    return normalizeJiraSummary(value, 8_000).replace(
      /([\\{}[\]*_#|])/g,
      '\\$1',
    );
  }

  private identifier(value: unknown): string | null {
    return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,255}$/.test(value)
      ? value
      : null;
  }

  private version(value: unknown): string | null {
    const record = this.record(value);
    const number = record?.number;
    return typeof number === 'number' || typeof number === 'string'
      ? String(number)
      : null;
  }

  private record(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private fail(
    code:
      | 'CONFLUENCE_VERSION_CONFLICT'
      | 'CONFLUENCE_WRITE_FAILED'
      | 'JIRA_REMOTE_LINK_FAILED'
      | 'JIRA_SUMMARY_COMMENT_FAILED'
      | 'JIRA_CHILD_TASK_FAILED',
    retryable: boolean,
  ): never {
    throw new PublicationGatewayError(code, retryable);
  }
}
