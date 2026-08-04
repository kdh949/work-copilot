import { Injectable } from '@nestjs/common';
import type {
  PublicationWriteGateway,
  PublicationWriteResult,
} from './publication-write-gateway';
import { PublicationGatewayError } from './publication-write-gateway';
import type { PublicationErrorCode } from './publication.types';
import type { IntegrationProfile } from '../integrations/profiles/entities/integration-profile.entity';
import type {
  BriefChildTask,
  BriefContent,
  StoredBriefEvidence,
} from '../work-briefs/brief-draft.types';
import type { ChildTaskTemplate } from '../integrations/profiles/entities/integration-profile.entity';

type MockFailure = {
  code: PublicationErrorCode;
  retryable: boolean;
};

@Injectable()
export class MockPublicationWriteGateway implements PublicationWriteGateway {
  readonly mode = 'mock' as const;

  private readonly queuedFailures = new Map<string, MockFailure[]>();

  failNext(
    stepKey: string,
    code: PublicationErrorCode,
    retryable = true,
  ): void {
    const failures = this.queuedFailures.get(stepKey) ?? [];
    failures.push({ code, retryable });
    this.queuedFailures.set(stepKey, failures);
  }

  upsertConfluenceBrief(input: {
    userId: number;
    correlationId: string;
    profile: IntegrationProfile;
    operationId: string;
    parentPageId: string;
    existingContentId: string | null;
    draftId: string;
    sourceJiraKey: string;
    content: BriefContent;
    evidence: StoredBriefEvidence[];
  }): Promise<PublicationWriteResult> {
    this.consumeFailure('confluence_page');
    const providerObjectId =
      input.existingContentId ?? `mock-confluence:${input.operationId}`;
    return Promise.resolve({
      providerObjectId,
      providerObjectVersion: '1',
      providerUrl: `https://mock.example.invalid/confluence/${encodeURIComponent(providerObjectId)}`,
    });
  }

  upsertJiraRemoteLink(input: {
    userId: number;
    correlationId: string;
    profile: IntegrationProfile;
    operationId: string;
    sourceJiraId: string;
    confluenceContentId: string;
    confluenceUrl: string | null;
    confluenceTitle: string;
  }): Promise<PublicationWriteResult> {
    this.consumeFailure('jira_remote_link');
    return Promise.resolve({
      providerObjectId: `mock-jira-link:${input.operationId}`,
    });
  }

  createJiraSummaryComment(input: {
    userId: number;
    correlationId: string;
    profile: IntegrationProfile;
    operationId: string;
    sourceJiraId: string;
    summary: string;
    confluenceContentId: string;
    confluenceUrl: string | null;
  }): Promise<PublicationWriteResult> {
    this.consumeFailure('jira_summary_comment');
    return Promise.resolve({
      providerObjectId: `mock-jira-comment:${input.operationId}`,
    });
  }

  createJiraChildTask(input: {
    userId: number;
    correlationId: string;
    profile: IntegrationProfile;
    operationId: string;
    sourceJiraId: string;
    sourceJiraKey: string;
    childTask: BriefChildTask;
    template: ChildTaskTemplate;
  }): Promise<PublicationWriteResult> {
    this.consumeFailure(`jira_child_task:${input.childTask.clientTaskId}`);
    return Promise.resolve({
      providerObjectId: `mock-jira-child:${input.operationId}:${input.childTask.clientTaskId}`,
    });
  }

  private consumeFailure(stepKey: string): void {
    const failures = this.queuedFailures.get(stepKey);
    const failure = failures?.shift();

    if (!failure) {
      return;
    }

    if (failures?.length === 0) {
      this.queuedFailures.delete(stepKey);
    }
    throw new PublicationGatewayError(failure.code, failure.retryable);
  }
}
