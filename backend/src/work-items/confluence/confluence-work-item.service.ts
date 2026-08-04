import { BadRequestException, Injectable } from '@nestjs/common';
import { IntegrationsOAuthService } from '../../integrations/oauth/integrations-oauth.service';
import type { IntegrationProfile } from '../../integrations/profiles/entities/integration-profile.entity';
import { AtlassianReadClientService } from '../atlassian-read-client.service';
import {
  type EvidenceCollectionResponse,
  type NormalizedEvidence,
  normalizeEvidence,
  toTransientPlainText,
} from '../evidence/evidence-normalizer';
import { IntegrationAccessPolicyService } from '../integration-access-policy.service';

const MAX_SEARCH_RESULTS = 10;
const MAX_TRANSIENT_EVIDENCE_CHARS = 8_000;
const MAX_RECOMMENDATION_TERMS = 3;

export type EvidenceRecommendationReason = 'jira_issue' | 'jira_summary';

export type ConfluenceEvidenceRecommendation = NormalizedEvidence & {
  recommendationReasons: EvidenceRecommendationReason[];
};

export type ConfluenceRecommendationResponse = {
  accessStatus: EvidenceCollectionResponse['accessStatus'];
  recommendations: ConfluenceEvidenceRecommendation[];
};

export type TransientConfluenceDraftEvidence = {
  evidence: NormalizedEvidence;
  content: string;
};

export type ConfluenceEvidenceContext = {
  accessStatus: EvidenceCollectionResponse['accessStatus'];
  profileId: string | null;
  evidence: NormalizedEvidence[];
};

export type ConfluenceDraftContext = {
  accessStatus: EvidenceCollectionResponse['accessStatus'];
  profileId: string | null;
  evidence: TransientConfluenceDraftEvidence[];
};

@Injectable()
export class ConfluenceWorkItemService {
  constructor(
    private readonly accessPolicy: IntegrationAccessPolicyService,
    private readonly readClient: AtlassianReadClientService,
    private readonly integrationsOAuthService: IntegrationsOAuthService,
  ) {}

  async searchEvidence(
    userId: number,
    spaceKeyValue: string,
    queryValue: string,
    correlationId: string,
  ): Promise<EvidenceCollectionResponse> {
    const query = this.query(queryValue);
    const profile = await this.accessPolicy.activeProfile();
    const spaceKey = this.accessPolicy.assertAllowedSpace(
      profile,
      spaceKeyValue,
    );
    const accessToken = await this.integrationsOAuthService.getAccessToken(
      userId,
      'confluence',
      correlationId,
    );
    const search = await this.readClient.getJson(
      this.searchUrl(profile, spaceKey, query),
      this.accessPolicy.providerBaseUrl(profile, 'confluence'),
      accessToken,
    );

    if (search.status !== 'ok') {
      return { accessStatus: search.status, evidence: [] };
    }

    const evidence: NormalizedEvidence[] = [];

    for (const item of this.searchResultItems(search.body)) {
      if (evidence.length >= MAX_SEARCH_RESULTS) {
        break;
      }

      const pageId = this.identifier(item.id);
      const itemSpaceKey = this.spaceKey(item);

      if (!pageId || itemSpaceKey !== spaceKey) {
        continue;
      }

      const page = await this.readClient.getJson(
        this.pageUrl(profile, pageId),
        this.accessPolicy.providerBaseUrl(profile, 'confluence'),
        accessToken,
      );

      if (page.status !== 'ok') {
        continue;
      }

      const normalized = this.normalizePage(profile, spaceKey, page.body);

      if (!evidence.some((entry) => entry.id === normalized.id)) {
        evidence.push(normalized);
      }
    }

    return { accessStatus: 'accessible', evidence };
  }

  /**
   * Finds likely supporting pages using Jira metadata only. The search asks
   * Confluence for page metadata (space, title, version) and deliberately
   * never fetches page storage. This keeps provider-authored page text out of
   * the recommendation and LLM-input paths until the user explicitly selects
   * a page for a draft.
   */
  async recommendEvidence(
    userId: number,
    issueKeyValue: string,
    jiraSummary: string,
    correlationId: string,
  ): Promise<ConfluenceRecommendationResponse> {
    const issueKey = this.recommendationIssueKey(issueKeyValue);
    const profile = await this.accessPolicy.activeProfile();
    const accessToken = await this.integrationsOAuthService.getAccessToken(
      userId,
      'confluence',
      correlationId,
    );
    const terms = this.recommendationTerms(issueKey, jiraSummary);
    const collected = new Map<string, ConfluenceEvidenceRecommendation>();
    let lastUnavailable: Exclude<
      EvidenceCollectionResponse['accessStatus'],
      'accessible'
    > = 'not_found';
    let hasAccessibleSearch = false;

    for (const term of terms) {
      for (const configuredSpaceKey of profile.allowedSpaceKeys) {
        const spaceKey = this.accessPolicy.assertAllowedSpace(
          profile,
          configuredSpaceKey,
        );
        const search = await this.readClient.getJson(
          this.recommendationSearchUrl(profile, spaceKey, term.value),
          this.accessPolicy.providerBaseUrl(profile, 'confluence'),
          accessToken,
        );
        if (search.status !== 'ok') {
          lastUnavailable = search.status;
          continue;
        }
        hasAccessibleSearch = true;

        for (const item of this.searchResultItems(search.body)) {
          if (collected.size >= MAX_SEARCH_RESULTS) {
            break;
          }
          let evidence: NormalizedEvidence;
          try {
            evidence = this.normalizeRecommendationPage(
              profile,
              spaceKey,
              item,
            );
          } catch {
            // Provider metadata outside the user's configured boundary is
            // omitted without reflecting it in the response.
            continue;
          }
          const existing = collected.get(evidence.id);
          if (existing) {
            if (!existing.recommendationReasons.includes(term.reason)) {
              existing.recommendationReasons.push(term.reason);
            }
            continue;
          }
          collected.set(evidence.id, {
            ...evidence,
            recommendationReasons: [term.reason],
          });
        }
      }
    }

    if (!hasAccessibleSearch) {
      return { accessStatus: lastUnavailable, recommendations: [] };
    }

    return {
      accessStatus: 'accessible',
      recommendations: [...collected.values()]
        .map((recommendation) => ({
          ...recommendation,
          recommendationReasons: [...recommendation.recommendationReasons].sort(
            (left, right) => this.compareRecommendationReason(left, right),
          ),
        }))
        .sort((left, right) => this.compareRecommendations(left, right)),
    };
  }

  /**
   * Re-reads only selected Confluence page metadata.  This is deliberately an
   * internal adapter result: it never returns raw page storage to a controller
   * or persists it with a draft.
   */
  async collectEvidenceMetadata(
    userId: number,
    evidenceIds: readonly string[],
    correlationId: string,
  ): Promise<ConfluenceEvidenceContext> {
    const sourceIds = this.selectedSourceIds(evidenceIds);
    const profile = await this.accessPolicy.activeProfile();
    const accessToken = await this.integrationsOAuthService.getAccessToken(
      userId,
      'confluence',
      correlationId,
    );
    const evidence: NormalizedEvidence[] = [];

    for (const sourceId of sourceIds) {
      const page = await this.readClient.getJson(
        this.pageUrl(profile, sourceId, false),
        this.accessPolicy.providerBaseUrl(profile, 'confluence'),
        accessToken,
      );

      if (page.status !== 'ok') {
        return this.unavailableMetadata(page.status);
      }

      try {
        const normalized = this.normalizeSelectedPage(profile, page.body);

        if (normalized.id !== `confluence:${sourceId}`) {
          return this.unavailableMetadata('access_limited');
        }
        evidence.push(normalized);
      } catch {
        // A selected page outside the current allowlist or user-visible
        // boundary is treated as unavailable without exposing its metadata.
        return this.unavailableMetadata('access_limited');
      }
    }

    return { accessStatus: 'accessible', profileId: profile.id, evidence };
  }

  /**
   * Retrieves a short plaintext fragment only for the immediate AI request.
   * Callers must pass it to the DLP boundary and must not serialize this
   * result into a response, log, or persistent draft.
   */
  async collectDraftEvidence(
    userId: number,
    evidenceIds: readonly string[],
    correlationId: string,
  ): Promise<ConfluenceDraftContext> {
    const sourceIds = this.selectedSourceIds(evidenceIds);
    const profile = await this.accessPolicy.activeProfile();
    const accessToken = await this.integrationsOAuthService.getAccessToken(
      userId,
      'confluence',
      correlationId,
    );
    const evidence: TransientConfluenceDraftEvidence[] = [];

    for (const sourceId of sourceIds) {
      const page = await this.readClient.getJson(
        this.pageUrl(profile, sourceId),
        this.accessPolicy.providerBaseUrl(profile, 'confluence'),
        accessToken,
      );

      if (page.status !== 'ok') {
        return this.unavailableDraftEvidence(page.status);
      }

      try {
        const transient = this.toTransientDraftEvidence(profile, page.body);

        if (transient.evidence.id !== `confluence:${sourceId}`) {
          return this.unavailableDraftEvidence('access_limited');
        }
        evidence.push(transient);
      } catch {
        return this.unavailableDraftEvidence('access_limited');
      }
    }

    return { accessStatus: 'accessible', profileId: profile.id, evidence };
  }

  private searchUrl(
    profile: IntegrationProfile,
    spaceKey: string,
    query: string,
  ): URL {
    // Confluence Data Center accepts CQL as the content-search query parameter.
    // The escaped literal keeps the caller from altering the fixed space/type guard.
    // Source: https://developer.atlassian.com/server/confluence/advanced-searching-using-cql/
    const cql = `space = "${spaceKey}" AND type = page AND text ~ "${this.cqlText(query)}"`;
    const parameters = new URLSearchParams({
      cql,
      expand: 'space,version',
      limit: String(MAX_SEARCH_RESULTS),
    });

    return this.accessPolicy.providerUrl(
      profile,
      'confluence',
      `rest/api/content/search?${parameters.toString()}`,
    );
  }

  private recommendationSearchUrl(
    profile: IntegrationProfile,
    spaceKey: string,
    term: string,
  ): URL {
    const cql = `space = "${spaceKey}" AND type = page AND title ~ "${this.cqlText(term)}"`;
    const parameters = new URLSearchParams({
      cql,
      expand: 'space,version',
      limit: String(MAX_SEARCH_RESULTS),
    });

    return this.accessPolicy.providerUrl(
      profile,
      'confluence',
      `rest/api/content/search?${parameters.toString()}`,
    );
  }

  private pageUrl(
    profile: IntegrationProfile,
    pageId: string,
    includeBody = true,
  ): URL {
    // Content expansions provide only the page body, space, and version needed
    // to normalize evidence; the excerpt itself is discarded after measuring.
    // Source: https://developer.atlassian.com/server/confluence/confluence-server-rest-api/
    const parameters = new URLSearchParams({
      expand: includeBody ? 'space,version,body.storage' : 'space,version',
    });

    return this.accessPolicy.providerUrl(
      profile,
      'confluence',
      `rest/api/content/${encodeURIComponent(pageId)}?${parameters.toString()}`,
    );
  }

  private normalizePage(
    profile: IntegrationProfile,
    expectedSpaceKey: string,
    body: Record<string, unknown>,
  ): NormalizedEvidence {
    const pageId = this.identifier(body.id);
    const spaceKey = this.spaceKey(body);

    if (!pageId || spaceKey !== expectedSpaceKey) {
      throw new BadRequestException('Confluence page is invalid.');
    }

    this.accessPolicy.assertAllowedSpace(profile, spaceKey);
    const title = this.string(body.title);
    const version = this.version(body.version);
    const url = this.accessPolicy.providerUrl(
      profile,
      'confluence',
      `pages/viewpage.action?pageId=${encodeURIComponent(pageId)}`,
    );
    const bodyValue = this.record(body.body)?.storage;

    return normalizeEvidence({
      provider: 'confluence',
      sourceId: pageId,
      url: url.toString(),
      title,
      version,
      excerptSource: bodyValue,
    });
  }

  private normalizeSelectedPage(
    profile: IntegrationProfile,
    body: Record<string, unknown>,
  ): NormalizedEvidence {
    const spaceKey = this.spaceKey(body);

    if (!spaceKey) {
      throw new BadRequestException('Confluence page is invalid.');
    }

    return this.normalizePage(profile, spaceKey, body);
  }

  private normalizeRecommendationPage(
    profile: IntegrationProfile,
    expectedSpaceKey: string,
    body: Record<string, unknown>,
  ): NormalizedEvidence {
    const pageId = this.identifier(body.id);
    const spaceKey = this.spaceKey(body);
    if (!pageId || spaceKey !== expectedSpaceKey) {
      throw new BadRequestException('Confluence page is invalid.');
    }
    this.accessPolicy.assertAllowedSpace(profile, spaceKey);

    return normalizeEvidence({
      provider: 'confluence',
      sourceId: pageId,
      url: this.accessPolicy
        .providerUrl(
          profile,
          'confluence',
          `pages/viewpage.action?pageId=${encodeURIComponent(pageId)}`,
        )
        .toString(),
      title: this.string(body.title),
      version: this.version(body.version),
      excerptSource: undefined,
    });
  }

  private toTransientDraftEvidence(
    profile: IntegrationProfile,
    body: Record<string, unknown>,
  ): TransientConfluenceDraftEvidence {
    const evidence = this.normalizeSelectedPage(profile, body);
    const bodyValue = this.record(body.body)?.storage;
    const content = `${evidence.title}\n${toTransientPlainText(
      bodyValue,
      MAX_TRANSIENT_EVIDENCE_CHARS,
    )}`.slice(0, MAX_TRANSIENT_EVIDENCE_CHARS);

    return { evidence, content };
  }

  private selectedSourceIds(evidenceIds: readonly string[]): string[] {
    if (evidenceIds.length === 0 || evidenceIds.length > 20) {
      throw new BadRequestException('Selected Confluence evidence is invalid.');
    }

    const sourceIds = evidenceIds.map((evidenceId) => {
      const match = /^confluence:([A-Za-z0-9_-]{1,255})$/.exec(evidenceId);

      if (!match) {
        throw new BadRequestException(
          'Selected Confluence evidence is invalid.',
        );
      }

      return match[1];
    });

    if (new Set(sourceIds).size !== sourceIds.length) {
      throw new BadRequestException('Selected Confluence evidence is invalid.');
    }

    return sourceIds;
  }

  private unavailableMetadata(
    accessStatus: Exclude<
      EvidenceCollectionResponse['accessStatus'],
      'accessible'
    >,
  ): ConfluenceEvidenceContext {
    return { accessStatus, profileId: null, evidence: [] };
  }

  private unavailableDraftEvidence(
    accessStatus: Exclude<
      EvidenceCollectionResponse['accessStatus'],
      'accessible'
    >,
  ): ConfluenceDraftContext {
    return { accessStatus, profileId: null, evidence: [] };
  }

  private searchResultItems(
    body: Record<string, unknown>,
  ): Record<string, unknown>[] {
    if (!Array.isArray(body.results)) {
      throw new BadRequestException('Confluence search response is invalid.');
    }

    return body.results.flatMap((item) => {
      if (!this.isRecord(item)) {
        return [];
      }

      const content = this.record(item.content);
      return [content ?? item];
    });
  }

  private spaceKey(value: Record<string, unknown>): string | null {
    const space = this.record(value.space);

    if (!space || typeof space.key !== 'string') {
      return null;
    }

    return space.key.trim().toUpperCase();
  }

  private version(value: unknown): string {
    const version = this.record(value);

    if (
      !version ||
      (typeof version.number !== 'number' && typeof version.number !== 'string')
    ) {
      throw new BadRequestException('Confluence page is invalid.');
    }

    return String(version.number);
  }

  private query(value: string): string {
    const normalized = value.trim();

    if (
      !normalized ||
      normalized.length > 200 ||
      [...normalized].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
      })
    ) {
      throw new BadRequestException('Confluence search query is invalid.');
    }

    return normalized;
  }

  private cqlText(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private recommendationIssueKey(value: string): string {
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{0,31}-[1-9][0-9]*$/.test(normalized)) {
      throw new BadRequestException('Jira issue key is invalid.');
    }
    return normalized;
  }

  private recommendationTerms(
    issueKey: string,
    jiraSummary: string,
  ): Array<{ value: string; reason: EvidenceRecommendationReason }> {
    const summaryTerms = jiraSummary
      .trim()
      .split(/[\s,.:/()[\]{}'"`!?…_-]+/u)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2 && term.length <= 80)
      .filter((term, index, values) => values.indexOf(term) === index)
      .slice(0, MAX_RECOMMENDATION_TERMS);

    return [
      { value: issueKey, reason: 'jira_issue' },
      ...summaryTerms.map((value) => ({
        value,
        reason: 'jira_summary' as const,
      })),
    ];
  }

  private compareRecommendationReason(
    left: EvidenceRecommendationReason,
    right: EvidenceRecommendationReason,
  ): number {
    return left === right ? 0 : left === 'jira_issue' ? -1 : 1;
  }

  private compareRecommendations(
    left: ConfluenceEvidenceRecommendation,
    right: ConfluenceEvidenceRecommendation,
  ): number {
    const leftIssueMatch = left.recommendationReasons.includes('jira_issue');
    const rightIssueMatch = right.recommendationReasons.includes('jira_issue');
    if (leftIssueMatch !== rightIssueMatch) {
      return leftIssueMatch ? -1 : 1;
    }
    const leftTitle = left.title.normalize('NFKC').toLowerCase();
    const rightTitle = right.title.normalize('NFKC').toLowerCase();
    if (leftTitle !== rightTitle) {
      return leftTitle < rightTitle ? -1 : 1;
    }
    return left.sourceId === right.sourceId
      ? 0
      : left.sourceId < right.sourceId
        ? -1
        : 1;
  }

  private identifier(value: unknown): string | null {
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
      return String(value);
    }

    if (typeof value === 'string' && /^[A-Za-z0-9_-]{1,255}$/.test(value)) {
      return value;
    }

    return null;
  }

  private string(value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new BadRequestException('Confluence page is invalid.');
    }

    return value;
  }

  private record(value: unknown): Record<string, unknown> | null {
    return this.isRecord(value) ? value : null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
