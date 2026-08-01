import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ConfluenceWorkItemService } from './confluence/confluence-work-item.service';
import { JiraWorkItemService } from './jira/jira-work-item.service';
import { WorkItemsController } from './work-items.controller';

describe('WorkItemsController', () => {
  it('requires a BFF session for every work-item endpoint', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, WorkItemsController) as unknown,
    ).toEqual([SessionAuthGuard]);
  });

  it('uses the documented context route and legacy alias for the same authenticated Jira read', async () => {
    const collectIssueEvidence = jest.fn(() =>
      Promise.resolve({ evidence: [] }),
    );
    const controller = new WorkItemsController(
      { collectIssueEvidence } as unknown as JiraWorkItemService,
      {} as ConfluenceWorkItemService,
    );

    const request = {
      user: { sub: 42 },
      correlationId: 'corr-42',
    } as never;

    await controller.jiraContext('ENG-1', request);
    await controller.jiraIssue('ENG-1', request);

    expect(collectIssueEvidence).toHaveBeenNthCalledWith(
      1,
      42,
      'ENG-1',
      'corr-42',
    );
    expect(collectIssueEvidence).toHaveBeenNthCalledWith(
      2,
      42,
      'ENG-1',
      'corr-42',
    );
  });
});
