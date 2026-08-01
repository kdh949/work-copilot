import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  SessionAuthGuard,
  type AuthenticatedRequest,
} from '../auth/guards/session-auth.guard';
import type { CorrelatedRequest } from '../common/http/correlation-id.middleware';
import { ConfluenceSearchDto } from './dto/confluence-search.dto';
import { ConfluenceWorkItemService } from './confluence/confluence-work-item.service';
import { JiraWorkItemService } from './jira/jira-work-item.service';

type WorkItemRequest = AuthenticatedRequest & CorrelatedRequest;

@Controller('work-items')
@UseGuards(SessionAuthGuard)
export class WorkItemsController {
  constructor(
    private readonly jiraWorkItemService: JiraWorkItemService,
    private readonly confluenceWorkItemService: ConfluenceWorkItemService,
  ) {}

  @Get('jira/:issueKey/context')
  jiraContext(
    @Param('issueKey') issueKey: string,
    @Req() request: WorkItemRequest,
  ) {
    return this.jiraWorkItemService.collectIssueEvidence(
      request.user.sub,
      issueKey,
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  // Keep the initial UI route working while clients move to the documented
  // context contract. Both routes use exactly the same authenticated read.
  @Get('jira/issues/:issueKey')
  jiraIssue(
    @Param('issueKey') issueKey: string,
    @Req() request: WorkItemRequest,
  ) {
    return this.jiraContext(issueKey, request);
  }

  @Get('confluence/spaces/:spaceKey/search')
  confluenceSearch(
    @Param('spaceKey') spaceKey: string,
    @Query() query: ConfluenceSearchDto,
    @Req() request: WorkItemRequest,
  ) {
    return this.confluenceWorkItemService.searchEvidence(
      request.user.sub,
      spaceKey,
      query.q,
      request.correlationId ?? 'missing-correlation-id',
    );
  }
}
