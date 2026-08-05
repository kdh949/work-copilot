import { ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { IntegrationsOAuthService } from '../integrations/oauth/integrations-oauth.service';
import type { IntegrationProfile } from '../integrations/profiles/entities/integration-profile.entity';
import { AtlassianReadClientService } from '../work-items/atlassian-read-client.service';
import { IntegrationAccessPolicyService } from '../work-items/integration-access-policy.service';
import type { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';
import type { BriefPublication } from './entities/brief-publication.entity';
import type { PublicationPhase } from './publication.types';
import { PublicationRendererService } from './publication-renderer.service';
import { confluencePublicationTitle } from './confluence-publication-title';
import {
  buildChildTaskCreatePayload,
  type CanonicalChildTaskCreatePayload,
} from './child-task-create-payload';

type PreviewEvidence = {
  id: string;
  provider: 'jira' | 'confluence';
  title: string;
  url: string;
  version: string;
};

export type ConfluencePublicationPreview = {
  phase: 'confluence';
  draftVersion: number;
  approvalRevision?: number;
  previewHash: string;
  spaceKey: string;
  parentPage: { id: string; title: string; url: string; version: string };
  pageTitle: string;
  bodyPreview: string;
  contentHash: string;
  evidence: PreviewEvidence[];
};

export type JiraPublicationPreview = {
  phase: 'jira';
  draftVersion: number;
  approvalRevision?: number;
  previewHash: string;
  confluencePage: { id: string; url: string; title: string };
  remoteLink: { globalId: string; url: string; title: string };
  summaryComment: { summary: string; url: string };
};

export type ChildTasksPublicationPreview = {
  phase: 'child_tasks';
  draftVersion: number;
  approvalRevision?: number;
  previewHash: string;
  configurationFingerprint: string;
  childTasks: Array<{
    clientTaskId: string;
    summary: string;
    payload: CanonicalChildTaskCreatePayload;
  }>;
};

export type PublicationPreview =
  | ConfluencePublicationPreview
  | JiraPublicationPreview
  | ChildTasksPublicationPreview;

@Injectable()
export class PublicationPreviewService {
  constructor(
    private readonly oauth: IntegrationsOAuthService,
    private readonly accessPolicy: IntegrationAccessPolicyService,
    private readonly readClient: AtlassianReadClientService,
    private readonly renderer: PublicationRendererService,
  ) {}

  async confluence(
    userId: number,
    draft: WorkBriefDraft,
    profile: IntegrationProfile,
    correlationId: string,
  ): Promise<ConfluencePublicationPreview> {
    const parentPageId = profile.briefParentPageId?.trim();
    if (!parentPageId) {
      throw new ConflictException({ code: 'PUBLISH_PARENT_PAGE_REQUIRED' });
    }
    const accessToken = await this.oauth.getAccessToken(
      userId,
      'confluence',
      correlationId,
    );
    const parent = await this.readClient.getJson(
      this.accessPolicy.providerUrl(
        profile,
        'confluence',
        `rest/api/content/${encodeURIComponent(parentPageId)}?expand=space,version`,
      ),
      this.accessPolicy.providerBaseUrl(profile, 'confluence'),
      accessToken,
    );
    if (parent.status !== 'ok') {
      throw new ConflictException({ code: 'PUBLISH_PARENT_PAGE_UNAVAILABLE' });
    }
    const parentId = this.identifier(parent.body.id);
    const title = this.text(parent.body.title);
    const version = this.version(parent.body.version);
    const space = this.record(parent.body.space);
    const spaceKey = this.text(space?.key)?.toUpperCase();
    if (!parentId || !title || !version || !spaceKey) {
      throw new ConflictException({ code: 'PUBLISH_PARENT_PAGE_UNAVAILABLE' });
    }
    this.accessPolicy.assertAllowedSpace(profile, spaceKey);

    const rendered = this.renderer.render(
      draft.sourceJiraKey,
      draft.maskedBrief,
      draft.evidence,
    );
    const evidence = draft.evidence.map((item) => ({
      id: item.id,
      provider: item.provider,
      title: item.title,
      url: item.url,
      version: item.version,
    }));
    const parentUrl = this.accessPolicy
      .providerUrl(
        profile,
        'confluence',
        `pages/viewpage.action?pageId=${encodeURIComponent(parentId)}`,
      )
      .toString();
    const preview: Omit<ConfluencePublicationPreview, 'previewHash'> = {
      phase: 'confluence',
      draftVersion: draft.optimisticVersion,
      spaceKey,
      parentPage: { id: parentId, title, url: parentUrl, version },
      pageTitle: confluencePublicationTitle(
        rendered.pageTitle,
        draft.id,
        rendered.contentHash,
      ),
      bodyPreview: rendered.storageBody,
      contentHash: rendered.contentHash,
      evidence,
    };
    return { ...preview, previewHash: this.hash(preview) };
  }

  jira(
    draft: WorkBriefDraft,
    publication: BriefPublication,
  ): JiraPublicationPreview {
    const pageId = publication.confluenceContentId;
    const pageUrl = publication.confluencePageUrl;
    if (!pageId || !pageUrl) {
      throw new ConflictException({ code: 'CONFLUENCE_PUBLICATION_REQUIRED' });
    }
    const pageTitle =
      `[${draft.sourceJiraKey}] ${draft.maskedBrief.title.text}`.slice(0, 255);
    const preview: Omit<JiraPublicationPreview, 'previewHash'> = {
      phase: 'jira',
      draftVersion: draft.optimisticVersion,
      confluencePage: { id: pageId, url: pageUrl, title: pageTitle },
      remoteLink: {
        globalId: `work-copilot:publication:${publication.operationId}`,
        url: pageUrl,
        title: pageTitle,
      },
      summaryComment: {
        summary: draft.maskedBrief.summary.text,
        url: pageUrl,
      },
    };
    return { ...preview, previewHash: this.hash(preview) };
  }

  childTasks(
    draft: WorkBriefDraft,
    publication: BriefPublication,
    profile: IntegrationProfile,
  ): ChildTasksPublicationPreview {
    if (!publication.confluenceContentId) {
      throw new ConflictException({ code: 'CONFLUENCE_PUBLICATION_REQUIRED' });
    }
    const template = profile.policy.childTaskTemplate;
    if (!template) {
      throw new ConflictException({ code: 'CHILD_TASK_TEMPLATE_REQUIRED' });
    }
    const preview: Omit<ChildTasksPublicationPreview, 'previewHash'> = {
      phase: 'child_tasks',
      draftVersion: draft.optimisticVersion,
      configurationFingerprint: this.configurationFingerprint(profile),
      childTasks: draft.maskedBrief.childTasks
        .filter((task) => task.selected)
        .map((task) => {
          const payload = buildChildTaskCreatePayload({
            sourceJiraId: draft.sourceJiraId,
            sourceJiraKey: draft.sourceJiraKey,
            childTask: task,
            template,
          });
          if (!payload) {
            throw new ConflictException({
              code: 'CHILD_TASK_TEMPLATE_REQUIRED',
            });
          }
          return {
            clientTaskId: task.clientTaskId,
            summary: payload.fields.summary as string,
            payload,
          };
        }),
    };
    return { ...preview, previewHash: this.hash(preview) };
  }

  hashFor(preview: PublicationPreview): string {
    return preview.previewHash;
  }

  phase(preview: PublicationPreview): PublicationPhase {
    return preview.phase;
  }

  private hash(value: object): string {
    return createHash('sha256')
      .update(JSON.stringify(this.canonical(value)))
      .digest('hex');
  }

  private configurationFingerprint(profile: IntegrationProfile): string {
    return this.hash({
      profileId: profile.id,
      jiraBaseUrl: profile.jiraBaseUrl,
      allowedProjectKeys: [...profile.allowedProjectKeys].sort(),
      childTaskTemplate: profile.policy.childTaskTemplate,
    });
  }

  private canonical(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.canonical(item));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, this.canonical(item)]),
      );
    }
    return value;
  }

  private identifier(value: unknown): string | null {
    return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,255}$/.test(value)
      ? value
      : null;
  }

  private text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private version(value: unknown): string | null {
    const record = this.record(value);
    const number = record?.number;
    return typeof number === 'string' || typeof number === 'number'
      ? String(number)
      : null;
  }

  private record(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
}
