import type { ChildTaskTemplate } from '../integrations/profiles/entities/integration-profile.entity';
import type { IntegrationProfile } from '../integrations/profiles/entities/integration-profile.entity';
import type {
  BriefChildTask,
  BriefContent,
  StoredBriefEvidence,
} from '../work-briefs/brief-draft.types';
import type { PublicationErrorCode } from './publication.types';

export const PUBLICATION_WRITE_GATEWAY = Symbol('PUBLICATION_WRITE_GATEWAY');

export type PublicationWriteResult = {
  providerObjectId: string;
  providerObjectVersion?: string;
  providerUrl?: string;
  contentHash?: string;
};

type PublicationGatewayContext = {
  userId: number;
  correlationId: string;
  profile: IntegrationProfile;
};

export type PublicationWriteGateway = {
  readonly mode: 'mock' | 'real';
  upsertConfluenceBrief(
    input: PublicationGatewayContext & {
      operationId: string;
      parentPageId: string;
      existingContentId: string | null;
      draftId: string;
      sourceJiraKey: string;
      content: BriefContent;
      evidence: StoredBriefEvidence[];
    },
  ): Promise<PublicationWriteResult>;
  upsertJiraRemoteLink(
    input: PublicationGatewayContext & {
      operationId: string;
      sourceJiraId: string;
      confluenceContentId: string;
      confluenceUrl: string | null;
      confluenceTitle: string;
    },
  ): Promise<PublicationWriteResult>;
  createJiraSummaryComment(
    input: PublicationGatewayContext & {
      operationId: string;
      sourceJiraId: string;
      summary: string;
      confluenceContentId: string;
      confluenceUrl: string | null;
    },
  ): Promise<PublicationWriteResult>;
  createJiraChildTask(
    input: PublicationGatewayContext & {
      operationId: string;
      sourceJiraId: string;
      sourceJiraKey: string;
      childTask: BriefChildTask;
      template: ChildTaskTemplate;
    },
  ): Promise<PublicationWriteResult>;
};

export class PublicationGatewayError extends Error {
  constructor(
    readonly code: PublicationErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}
