import type { ChildTaskTemplate } from '../integrations/profiles/entities/integration-profile.entity';
import type {
  BriefChildTask,
  BriefContent,
} from '../work-briefs/brief-draft.types';
import type { PublicationErrorCode } from './publication.types';

export const PUBLICATION_WRITE_GATEWAY = Symbol('PUBLICATION_WRITE_GATEWAY');

export type PublicationWriteResult = {
  providerObjectId: string;
};

export type PublicationWriteGateway = {
  readonly mode: 'mock';
  upsertConfluenceBrief(input: {
    operationId: string;
    parentPageId: string;
    existingContentId: string | null;
    draftId: string;
    content: BriefContent;
  }): Promise<PublicationWriteResult>;
  upsertJiraRemoteLink(input: {
    operationId: string;
    sourceJiraId: string;
    confluenceContentId: string;
  }): Promise<PublicationWriteResult>;
  createJiraSummaryComment(input: {
    operationId: string;
    sourceJiraId: string;
    summary: string;
  }): Promise<PublicationWriteResult>;
  createJiraChildTask(input: {
    operationId: string;
    sourceJiraId: string;
    childTask: BriefChildTask;
    template: ChildTaskTemplate;
  }): Promise<PublicationWriteResult>;
};

export class PublicationGatewayError extends Error {
  constructor(
    readonly code: PublicationErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}
