import { Injectable } from '@nestjs/common';
import { IntegrationsOAuthService } from '../integrations/oauth/integrations-oauth.service';
import type {
  ChildTaskTemplate,
  IntegrationProfile,
} from '../integrations/profiles/entities/integration-profile.entity';
import {
  AtlassianReadClientService,
  type ProviderReadResult,
} from '../work-items/atlassian-read-client.service';
import {
  AtlassianWriteClientService,
  type ProviderWriteResult,
} from '../work-items/atlassian-write-client.service';
import { IntegrationAccessPolicyService } from '../work-items/integration-access-policy.service';
import type {
  BriefChildTask,
  BriefContent,
  StoredBriefEvidence,
} from '../work-briefs/brief-draft.types';
import {
  PublicationGatewayError,
  type ChildTaskReconciliationEntry,
  type PublicationWriteGateway,
  type PublicationWriteResult,
  type ReconciliationResult,
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

type PageContinuation = 'yes' | 'no' | 'invalid';

type IssueProperty =
  | { state: 'found'; value: Record<string, unknown> }
  | { state: 'absent' }
  | { state: 'unknown' };

/**
 * Real, user-context-only publication adapter for Jira and Confluence Data
 * Center. It persists only stable provider identifiers and uses deterministic
 * markers for recovery after a response is lost.
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
      if (existing.status === 'found') {
        return this.confluenceResult(existing.value, rendered.contentHash);
      }
      if (existing.status === 'indeterminate') {
        this.failReconciliation();
      }
      this.fail('CONFLUENCE_VERSION_CONFLICT', false);
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
    if (reconciled.status === 'found') {
      return this.confluenceResult(reconciled.value, rendered.contentHash);
    }
    if (reconciled.status === 'indeterminate') {
      this.failReconciliation();
    }

    const createBody = {
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
    };
    let created: ProviderWriteResult;
    try {
      created = await this.writeClient.postJsonExpectObject(
        this.accessPolicy.providerUrl(
          input.profile,
          'confluence',
          'rest/api/content',
        ),
        this.accessPolicy.providerBaseUrl(input.profile, 'confluence'),
        accessToken,
        createBody,
      );
    } catch {
      return this.reconcileAfterUncertainConfluenceCreate(
        input.profile,
        accessToken,
        parent.id,
        pageTitle,
        rendered.contentHash,
      );
    }

    const createdPage =
      created.status === 'ok'
        ? this.confluencePageFromBody(input.profile, created.body)
        : null;
    if (createdPage) {
      return this.confluenceResult(createdPage, rendered.contentHash);
    }

    if (
      created.status === 'ok_empty' ||
      created.status === 'ok' ||
      created.status === 'unavailable'
    ) {
      return this.reconcileAfterUncertainConfluenceCreate(
        input.profile,
        accessToken,
        parent.id,
        pageTitle,
        rendered.contentHash,
      );
    }

    const recovered = await this.findConfluencePageByTitle(
      input.profile,
      accessToken,
      parent.id,
      pageTitle,
    );
    if (recovered.status === 'found') {
      return this.confluenceResult(recovered.value, rendered.contentHash);
    }
    if (recovered.status === 'indeterminate') {
      this.failReconciliation();
    }
    if (created.status === 'conflict') {
      this.fail('CONFLUENCE_VERSION_CONFLICT', false);
    }
    if (created.status === 'access_limited') {
      this.failReconciliation();
    }
    this.fail('CONFLUENCE_WRITE_FAILED', created.status === 'rejected');
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
    const existing = await this.findRemoteLink(endpoint, input.profile, accessToken);
    if (existing.status === 'found') {
      return { providerObjectId: existing.value, providerUrl: linkUrl };
    }
    if (existing.status === 'indeterminate') {
      this.failReconciliation();
    }

    const createBody = {
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
    };
    let created: ProviderWriteResult;
    try {
      created = await this.writeClient.postJsonExpectObject(
        this.accessPolicy.providerUrl(
          input.profile,
          'jira',
          `rest/api/2/issue/${encodeURIComponent(input.sourceJiraId)}/remotelink`,
        ),
        this.accessPolicy.providerBaseUrl(input.profile, 'jira'),
        accessToken,
        createBody,
      );
    } catch {
      return this.reconcileAfterUncertainRemoteLinkCreate(
        endpoint,
        input.profile,
        accessToken,
        linkUrl,
      );
    }

    if (created.status === 'ok') {
      const id = this.identifier(created.body.id);
      if (id) {
        return { providerObjectId: id, providerUrl: linkUrl };
      }
    }
    if (
      created.status === 'ok_empty' ||
      created.status === 'ok' ||
      created.status === 'unavailable'
    ) {
      return this.reconcileAfterUncertainRemoteLinkCreate(
        endpoint,
        input.profile,
        accessToken,
        linkUrl,
      );
    }

    const recovered = await this.findRemoteLink(endpoint, input.profile, accessToken);
    if (recovered.status === 'found') {
      return { providerObjectId: recovered.value, providerUrl: linkUrl };
    }
    if (recovered.status === 'indeterminate') {
      this.failReconciliation();
    }
    if (created.status === 'access_limited') {
      this.failReconciliation();
    }
    this.fail('JIRA_REMOTE_LINK_FAILED', created.status === 'rejected');
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
    if (existing.status === 'found') {
      return { providerObjectId: existing.value };
    }
    if (existing.status === 'indeterminate') {
      this.failReconciliation();
    }

    const pageUrl =
      input.confluenceUrl ??
      this.confluencePageUrl(input.profile, input.confluenceContentId);
    const createBody = {
      body: `${this.escapeJiraWiki(input.summary)}\n\nConfluence: ${pageUrl}\n${marker}`,
    };
    let created: ProviderWriteResult;
    try {
      created = await this.writeClient.postJsonExpectObject(
        endpoint,
        this.accessPolicy.providerBaseUrl(input.profile, 'jira'),
        accessToken,
        createBody,
      );
    } catch {
      return this.reconcileAfterUncertainCommentCreate(
        endpoint,
        input.profile,
        accessToken,
        marker,
      );
    }

    if (created.status === 'ok') {
      const id = this.identifier(created.body.id);
      if (id) {
        return { providerObjectId: id };
      }
    }
    if (
      created.status === 'ok_empty' ||
      created.status === 'ok' ||
      created.status === 'unavailable'
    ) {
      return this.reconcileAfterUncertainCommentCreate(
        endpoint,
        input.profile,
        accessToken,
        marker,
      );
    }

    const recovered = await this.findCommentByMarker(
      endpoint,
      input.profile,
      accessToken,
      marker,
    );
    if (recovered.status === 'found') {
      return { providerObjectId: recovered.value };
    }
    if (recovered.status === 'indeterminate') {
      this.failReconciliation();
    }
    if (created.status === 'access_limited') {
      this.failReconciliation();
    }
    this.fail('JIRA_SUMMARY_COMMENT_FAILED', created.status === 'rejected');
  }

  async reconcileJiraChildTasks(
    input: GatewayContext & {
      operationId: string;
      sourceJiraKey: string;
      clientTaskIds: readonly string[];
    },
  ): Promise<ReconciliationResult<Map<string, ChildTaskReconciliationEntry>>> {
    const accessToken = await this.token(input, 'jira');
    return this.findChildTasksByOperation(
      input.profile,
      accessToken,
      input.sourceJiraKey,
      input.operationId,
      new Set(input.clientTaskIds),
      MAX_RECONCILIATION_PAGES,
      MAX_RECONCILIATION_PROPERTY_LOOKUPS,
    );
  }

  async createJiraChildTask(
    input: GatewayContext & {
      operationId: string;
      sourceJiraId: string;
      sourceJiraKey: string;
      childTask: BriefChildTask;
      template: ChildTaskTemplate;
      reconciledProviderObjectId?: string;
      reconciliationCompleted?: boolean;
    },
  ): Promise<PublicationWriteResult> {
    const accessToken = await this.token(input, 'jira');
    if (input.reconciledProviderObjectId) {
      return { providerObjectId: input.reconciledProviderObjectId };
    }
    if (!input.reconciliationCompleted) {
      const existing = await this.findChildTasksByOperation(
        input.profile,
        accessToken,
        input.sourceJiraKey,
        input.operationId,
        new Set([input.childTask.clientTaskId]),
        MAX_RECONCILIATION_PAGES,
        MAX_RECONCILIATION_PROPERTY_LOOKUPS,
      );
      if (existing.status === 'found') {
        const marker = existing.value.get(input.childTask.clientTaskId);
        if (marker) {
          return { providerObjectId: marker.issueId };
        }
      }
      if (existing.status === 'indeterminate') {
        this.failReconciliation();
      }
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
    const createBody = {
      fields: payload.fields,
      properties: [
        {
          key: JIRA_CHILD_PROPERTY_KEY,
          value: {
            operationId: input.operationId,
            clientTaskId: input.childTask.clientTaskId,
          },
        },
      ],
    };
    let created: ProviderWriteResult;
    try {
      created = await this.writeClient.postJsonExpectObject(
        this.accessPolicy.providerUrl(input.profile, 'jira', 'rest/api/2/issue'),
        this.accessPolicy.providerBaseUrl(input.profile, 'jira'),
        accessToken,
        createBody,
      );
    } catch {
      return this.reconcileAfterUncertainChildCreate(input, accessToken);
    }

    if (created.status === 'ok') {
      const createdId = this.identifier(created.body.id);
      if (createdId) {
        return { providerObjectId: createdId };
      }
    }
    if (
      created.status === 'ok_empty' ||
      created.status === 'ok' ||
      created.status === 'unavailable'
    ) {
      return this.reconcileAfterUncertainChildCreate(input, accessToken);
    }

    const recovered = await this.findChildTasksByOperation(
      input.profile,
      accessToken,
      input.sourceJiraKey,
      input.operationId,
      new Set([input.childTask.clientTaskId]),
      1,
      Math.min(5, MAX_RECONCILIATION_PROPERTY_LOOKUPS),
    );
    if (recovered.status === 'found') {
      const marker = recovered.value.get(input.childTask.clientTaskId);
      if (marker) {
        return { providerObjectId: marker.issueId };
      }
    }
    if (recovered.status === 'indeterminate') {
      this.failReconciliation();
    }
    if (created.status === 'access_limited') {
      this.failReconciliation();
    }
    this.fail('JIRA_CHILD_TASK_FAILED', created.status === 'rejected');
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
    let result: ProviderReadResult;
    try {
      result = await this.readClient.getJson(
        this.accessPolicy.providerUrl(
          profile,
          'confluence',
          `rest/api/content/${encodeURIComponent(parentPageId)}?expand=space,version`,
        ),
        this.accessPolicy.providerBaseUrl(profile, 'confluence'),
        accessToken,
      );
    } catch {
      this.failReconciliation();
    }
    if (result.status !== 'ok') {
      this.fail('CONFLUENCE_WRITE_FAILED', false);
    }
    const id = this.identifier(result.body.id);
    const space = this.record(result.body.space);
    const spaceKey = typeof space?.key === 'string' ? space.key.trim() : '';
    if (!id || !spaceKey) {
      this.failReconciliation();
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
  ): Promise<ReconciliationResult<ConfluencePage>> {
    let result: ProviderReadResult;
    try {
      result = await this.readClient.getJson(
        this.accessPolicy.providerUrl(
          profile,
          'confluence',
          `rest/api/content/${encodeURIComponent(pageId)}?expand=space,version`,
        ),
        this.accessPolicy.providerBaseUrl(profile, 'confluence'),
        accessToken,
      );
    } catch {
      return this.indeterminate('provider_unavailable');
    }
    if (result.status === 'not_found') {
      return { status: 'absent' };
    }
    if (result.status === 'access_limited') {
      return this.indeterminate('access_limited');
    }
    if (result.status !== 'ok') {
      return this.indeterminate('invalid_response');
    }
    const page = this.confluencePageFromBody(profile, result.body);
    return page
      ? { status: 'found', value: page }
      : this.indeterminate('invalid_response');
  }

  private async findConfluencePageByTitle(
    profile: IntegrationProfile,
    accessToken: string,
    parentPageId: string,
    expectedTitle: string,
  ): Promise<ReconciliationResult<ConfluencePage>> {
    let start = 0;
    for (let pageIndex = 0; pageIndex < MAX_RECONCILIATION_PAGES; pageIndex += 1) {
      let children: ProviderReadResult;
      try {
        children = await this.readClient.getJson(
          this.accessPolicy.providerUrl(
            profile,
            'confluence',
            `rest/api/content/${encodeURIComponent(parentPageId)}/child/page?expand=version&limit=${RECONCILIATION_PAGE_SIZE}&start=${start}`,
          ),
          this.accessPolicy.providerBaseUrl(profile, 'confluence'),
          accessToken,
        );
      } catch {
        return this.indeterminate('provider_unavailable');
      }
      if (children.status === 'access_limited') {
        return this.indeterminate('access_limited');
      }
      if (children.status !== 'ok') {
        return this.indeterminate('invalid_response');
      }
      if (!Array.isArray(children.body.results)) {
        return this.indeterminate('invalid_response');
      }
      const items = children.body.results;
      for (const item of items) {
        const candidate = this.record(item);
        if (!candidate || candidate.title !== expectedTitle) {
          continue;
        }
        const page = this.confluencePageFromBody(profile, candidate);
        return page
          ? { status: 'found', value: page }
          : this.indeterminate('invalid_response');
      }
      const continuation = this.pageContinuation(
        children.body,
        start,
        items.length,
      );
      if (continuation === 'invalid') {
        return this.indeterminate('invalid_response');
      }
      if (continuation === 'no') {
        return { status: 'absent' };
      }
      start += items.length;
    }
    return this.indeterminate('budget_exhausted');
  }

  private async findRemoteLink(
    endpoint: URL,
    profile: IntegrationProfile,
    accessToken: string,
  ): Promise<ReconciliationResult<string>> {
    let result: ProviderReadResult;
    try {
      result = await this.readClient.getJson(
        endpoint,
        this.accessPolicy.providerBaseUrl(profile, 'jira'),
        accessToken,
      );
    } catch {
      return this.indeterminate('provider_unavailable');
    }
    if (result.status === 'not_found') {
      return { status: 'absent' };
    }
    if (result.status === 'access_limited') {
      return this.indeterminate('access_limited');
    }
    if (result.status !== 'ok') {
      return this.indeterminate('invalid_response');
    }
    const id = this.identifier(result.body.id);
    if (id) {
      return { status: 'found', value: id };
    }
    return this.indeterminate('invalid_response');
  }

  private async findCommentByMarker(
    endpoint: URL,
    profile: IntegrationProfile,
    accessToken: string,
    marker: string,
  ): Promise<ReconciliationResult<string>> {
    let startAt = 0;
    for (let pageIndex = 0; pageIndex < MAX_RECONCILIATION_PAGES; pageIndex += 1) {
      let page: ProviderReadResult;
      try {
        const url = new URL(endpoint);
        url.searchParams.set('startAt', String(startAt));
        url.searchParams.set('maxResults', String(RECONCILIATION_PAGE_SIZE));
        page = await this.readClient.getJson(
          url,
          this.accessPolicy.providerBaseUrl(profile, 'jira'),
          accessToken,
        );
      } catch {
        return this.indeterminate('provider_unavailable');
      }
      if (page.status === 'access_limited') {
        return this.indeterminate('access_limited');
      }
      if (page.status !== 'ok' || !Array.isArray(page.body.comments)) {
        return this.indeterminate('invalid_response');
      }
      for (const comment of page.body.comments) {
        const candidate = this.record(comment);
        if (
          candidate &&
          typeof candidate.body === 'string' &&
          candidate.body.includes(marker)
        ) {
          const id = this.identifier(candidate.id);
          return id
            ? { status: 'found', value: id }
            : this.indeterminate('invalid_response');
        }
      }
      const continuation = this.pageContinuation(
        page.body,
        startAt,
        page.body.comments.length,
      );
      if (continuation === 'invalid') {
        return this.indeterminate('invalid_response');
      }
      if (continuation === 'no') {
        return { status: 'absent' };
      }
      startAt += page.body.comments.length;
    }
    return this.indeterminate('budget_exhausted');
  }

  private async findChildTasksByOperation(
    profile: IntegrationProfile,
    accessToken: string,
    parentIssueKey: string,
    operationId: string,
    targetClientTaskIds: ReadonlySet<string>,
    maxPages: number,
    maxPropertyLookups: number,
  ): Promise<ReconciliationResult<Map<string, ChildTaskReconciliationEntry>>> {
    const matches = new Map<string, ChildTaskReconciliationEntry>();
    let startAt = 0;
    let propertyLookups = 0;
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      const query = new URLSearchParams({
        jql: `parent = ${parentIssueKey}`,
        fields: 'summary',
        properties: JIRA_CHILD_PROPERTY_KEY,
        maxResults: String(RECONCILIATION_PAGE_SIZE),
        startAt: String(startAt),
      });
      let search: ProviderReadResult;
      try {
        search = await this.readClient.getJson(
          this.accessPolicy.providerUrl(
            profile,
            'jira',
            `rest/api/2/search?${query.toString()}`,
          ),
          this.accessPolicy.providerBaseUrl(profile, 'jira'),
          accessToken,
        );
      } catch {
        return this.indeterminate('provider_unavailable');
      }
      if (search.status === 'access_limited') {
        return this.indeterminate('access_limited');
      }
      if (search.status !== 'ok' || !Array.isArray(search.body.issues)) {
        return this.indeterminate('invalid_response');
      }

      for (const issue of search.body.issues) {
        const candidate = this.record(issue);
        const issueId = candidate ? this.identifier(candidate.id) : null;
        if (!candidate || !issueId) {
          return this.indeterminate('invalid_response');
        }
        const inline = this.issuePropertyValue(
          candidate,
          JIRA_CHILD_PROPERTY_KEY,
        );
        if (inline.state === 'absent') {
          continue;
        }
        let marker: Record<string, unknown> | null =
          inline.state === 'found' ? inline.value : null;
        if (marker === null) {
          if (propertyLookups >= maxPropertyLookups) {
            return this.indeterminate('budget_exhausted');
          }
          propertyLookups += 1;
          let property: ProviderReadResult;
          try {
            property = await this.readClient.getJson(
              this.accessPolicy.providerUrl(
                profile,
                'jira',
                `rest/api/2/issue/${encodeURIComponent(issueId)}/properties/${JIRA_CHILD_PROPERTY_KEY}`,
              ),
              this.accessPolicy.providerBaseUrl(profile, 'jira'),
              accessToken,
            );
          } catch {
            return this.indeterminate('provider_unavailable');
          }
          if (property.status === 'access_limited') {
            return this.indeterminate('access_limited');
          }
          if (property.status === 'ok') {
            if (!Object.prototype.hasOwnProperty.call(property.body, 'value')) {
              return this.indeterminate('invalid_response');
            }
            const value = this.record(property.body.value);
            marker = value;
          } else if (property.status !== 'not_found') {
            return this.indeterminate('invalid_response');
          }
        }
        if (!marker) {
          continue;
        }
        const markerOperationId = marker.operationId;
        const markerClientTaskId = marker.clientTaskId;
        if (
          typeof markerOperationId !== 'string' ||
          typeof markerClientTaskId !== 'string'
        ) {
          return this.indeterminate('invalid_response');
        }
        if (
          markerOperationId === operationId &&
          targetClientTaskIds.has(markerClientTaskId)
        ) {
          matches.set(markerClientTaskId, {
            issueId,
            operationId: markerOperationId,
          });
        }
      }

      const continuation = this.pageContinuation(
        search.body,
        startAt,
        search.body.issues.length,
      );
      if (continuation === 'invalid') {
        return this.indeterminate('invalid_response');
      }
      if (continuation === 'no') {
        return matches.size > 0
          ? { status: 'found', value: matches }
          : { status: 'absent' };
      }
      startAt += search.body.issues.length;
    }
    return this.indeterminate('budget_exhausted');
  }

  private pageContinuation(
    body: Record<string, unknown>,
    start: number,
    received: number,
  ): PageContinuation {
    if (received === 0) {
      return 'no';
    }
    if (Object.prototype.hasOwnProperty.call(body, 'total')) {
      return typeof body.total === 'number' && Number.isFinite(body.total)
        ? start + received < body.total
          ? 'yes'
          : 'no'
        : 'invalid';
    }
    if (Object.prototype.hasOwnProperty.call(body, 'isLast')) {
      return typeof body.isLast === 'boolean'
        ? body.isLast
          ? 'no'
          : 'yes'
        : 'invalid';
    }
    const links = this.record(body._links);
    if (Object.prototype.hasOwnProperty.call(body, '_links')) {
      return typeof links?.next === 'string' && links.next.trim()
        ? 'yes'
        : links
          ? 'no'
          : 'invalid';
    }
    return received >= RECONCILIATION_PAGE_SIZE ? 'yes' : 'no';
  }

  /**
   * `absent` means the search returned this issue's property set and our key
   * is not in it, so the issue is provably not ours and needs no follow-up
   * request. `unknown` means the response carried no property container at
   * all, which is the only case worth spending a per-issue lookup on.
   */
  private issuePropertyValue(
    issue: Record<string, unknown>,
    propertyKey: string,
  ): IssueProperty {
    const properties = issue.properties;
    if (Array.isArray(properties)) {
      for (const property of properties) {
        const candidate = this.record(property);
        if (candidate?.key === propertyKey) {
          const value = this.record(candidate.value);
          return value ? { state: 'found', value } : { state: 'absent' };
        }
      }
      return { state: 'absent' };
    }
    const record = this.record(properties);
    if (!record) {
      return { state: 'unknown' };
    }
    const direct = this.record(record[propertyKey]);
    if (direct) {
      return { state: 'found', value: this.record(direct.value) ?? direct };
    }
    for (const property of Object.values(record)) {
      const candidate = this.record(property);
      if (candidate?.key === propertyKey) {
        const value = this.record(candidate.value);
        return value ? { state: 'found', value } : { state: 'absent' };
      }
    }
    return { state: 'absent' };
  }

  private async reconcileAfterUncertainConfluenceCreate(
    profile: IntegrationProfile,
    accessToken: string,
    parentPageId: string,
    pageTitle: string,
    contentHash: string,
  ): Promise<never> {
    const recovered = await this.findConfluencePageByTitle(
      profile,
      accessToken,
      parentPageId,
      pageTitle,
    );
    if (recovered.status === 'found') {
      return this.confluenceResult(recovered.value, contentHash) as never;
    }
    this.failUncertainWrite();
  }

  private async reconcileAfterUncertainRemoteLinkCreate(
    endpoint: URL,
    profile: IntegrationProfile,
    accessToken: string,
    linkUrl: string,
  ): Promise<never> {
    const recovered = await this.findRemoteLink(endpoint, profile, accessToken);
    if (recovered.status === 'found') {
      return { providerObjectId: recovered.value, providerUrl: linkUrl } as never;
    }
    this.failUncertainWrite();
  }

  private async reconcileAfterUncertainCommentCreate(
    endpoint: URL,
    profile: IntegrationProfile,
    accessToken: string,
    marker: string,
  ): Promise<never> {
    const recovered = await this.findCommentByMarker(
      endpoint,
      profile,
      accessToken,
      marker,
    );
    if (recovered.status === 'found') {
      return { providerObjectId: recovered.value } as never;
    }
    this.failUncertainWrite();
  }

  private async reconcileAfterUncertainChildCreate(
    input: {
      profile: IntegrationProfile;
      sourceJiraKey: string;
      operationId: string;
      childTask: BriefChildTask;
    },
    accessToken: string,
  ): Promise<never> {
    const recovered = await this.findChildTasksByOperation(
      input.profile,
      accessToken,
      input.sourceJiraKey,
      input.operationId,
      new Set([input.childTask.clientTaskId]),
      1,
      Math.min(5, MAX_RECONCILIATION_PROPERTY_LOOKUPS),
    );
    if (recovered.status === 'found') {
      const marker = recovered.value.get(input.childTask.clientTaskId);
      if (marker) {
        return { providerObjectId: marker.issueId } as never;
      }
    }
    this.failUncertainWrite();
  }

  private confluenceResult(
    page: ConfluencePage,
    contentHash: string,
  ): PublicationWriteResult {
    return {
      providerObjectId: page.id,
      providerObjectVersion: page.version,
      providerUrl: page.url,
      contentHash,
    };
  }

  private confluencePageFromBody(
    profile: IntegrationProfile,
    body: Record<string, unknown>,
  ): ConfluencePage | null {
    const id = this.identifier(body.id);
    const version = this.version(body.version);
    if (!id || !version) {
      return null;
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
    const normalized =
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? String(value)
        : value;
    return typeof normalized === 'string' && /^[A-Za-z0-9:_-]{1,255}$/.test(normalized)
      ? normalized
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

  private indeterminate(
    reason:
      | 'budget_exhausted'
      | 'access_limited'
      | 'provider_unavailable'
      | 'invalid_response',
  ): ReconciliationResult<never> {
    return { status: 'indeterminate', reason };
  }

  /**
   * No create request was dispatched, so retrying cannot duplicate anything.
   */
  private failReconciliation(): never {
    this.fail('PUBLICATION_RECONCILIATION_INDETERMINATE', true);
  }

  /**
   * A create request was dispatched and reconciliation could not prove whether
   * it landed. Marked non-retryable so the step becomes NEEDS_REVIEW: the next
   * create needs an operator who has checked the provider, because a plain
   * retry would create a second object whenever the marker search missed a
   * write that actually succeeded.
   */
  private failUncertainWrite(): never {
    this.fail('PUBLICATION_RECONCILIATION_INDETERMINATE', false);
  }

  private fail(
    code:
      | 'CONFLUENCE_VERSION_CONFLICT'
      | 'CONFLUENCE_WRITE_FAILED'
      | 'PUBLICATION_RECONCILIATION_INDETERMINATE'
      | 'JIRA_REMOTE_LINK_FAILED'
      | 'JIRA_SUMMARY_COMMENT_FAILED'
      | 'JIRA_CHILD_TASK_FAILED',
    retryable: boolean,
  ): never {
    throw new PublicationGatewayError(code, retryable);
  }
}
