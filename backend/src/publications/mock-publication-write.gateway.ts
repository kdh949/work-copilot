import { Injectable } from '@nestjs/common';
import type {
  PublicationWriteGateway,
  PublicationWriteResult,
} from './publication-write-gateway';
import { PublicationGatewayError } from './publication-write-gateway';
import type { PublicationErrorCode } from './publication.types';

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
    operationId: string;
    parentPageId: string;
    existingContentId: string | null;
    draftId: string;
    content: unknown;
  }): Promise<PublicationWriteResult> {
    this.consumeFailure('confluence_page');
    return Promise.resolve({
      providerObjectId:
        input.existingContentId ?? `mock-confluence:${input.operationId}`,
    });
  }

  upsertJiraRemoteLink(input: {
    operationId: string;
    sourceJiraId: string;
    confluenceContentId: string;
  }): Promise<PublicationWriteResult> {
    this.consumeFailure('jira_remote_link');
    return Promise.resolve({
      providerObjectId: `mock-jira-link:${input.operationId}`,
    });
  }

  createJiraSummaryComment(input: {
    operationId: string;
    sourceJiraId: string;
    summary: string;
  }): Promise<PublicationWriteResult> {
    this.consumeFailure('jira_summary_comment');
    return Promise.resolve({
      providerObjectId: `mock-jira-comment:${input.operationId}`,
    });
  }

  createJiraChildTask(input: {
    operationId: string;
    sourceJiraId: string;
    childTask: { clientTaskId: string };
    template: unknown;
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
