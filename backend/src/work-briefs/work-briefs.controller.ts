import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import type { CorrelatedRequest } from '../common/http/correlation-id.middleware';
import type { AuthenticatedRequest } from '../auth/guards/session-auth.guard';
import {
  PublishBriefDraftDto,
  RetryPublicationDto,
} from '../publications/dto/publish-brief-draft.dto';
import { PublicationService } from '../publications/publication.service';
import { ReadinessService } from '../readiness/readiness.service';
import {
  CreateBriefDraftDto,
  ListBriefDraftsDto,
  RefreshBriefDraftDto,
  RegenerateBriefDraftDto,
  UpdateBriefDraftDto,
} from './dto/brief-draft.dto';
import { WorkBriefsService } from './work-briefs.service';

type WorkBriefRequest = AuthenticatedRequest & CorrelatedRequest;
const parseUuid = new ParseUUIDPipe();

@Controller()
@UseGuards(SessionAuthGuard)
export class WorkBriefsController {
  constructor(
    private readonly workBriefsService: WorkBriefsService,
    private readonly readinessService: ReadinessService,
    private readonly publicationService: PublicationService,
  ) {}

  @Post('brief-drafts')
  create(@Body() dto: CreateBriefDraftDto, @Req() request: WorkBriefRequest) {
    return this.workBriefsService.createDraft(
      request.user.sub,
      dto,
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  @Get('brief-drafts')
  list(@Query() query: ListBriefDraftsDto, @Req() request: WorkBriefRequest) {
    return this.workBriefsService.listDrafts(request.user.sub, query);
  }

  @Get('brief-drafts/:id')
  find(@Param('id', parseUuid) id: string, @Req() request: WorkBriefRequest) {
    return this.workBriefsService.findDraft(request.user.sub, id);
  }

  @Delete('brief-drafts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', parseUuid) id: string, @Req() request: WorkBriefRequest) {
    return this.workBriefsService.deleteDraft(
      request.user.sub,
      id,
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  @Get('brief-drafts/:id/readiness')
  readiness(@Param('id', parseUuid) id: string, @Req() request: WorkBriefRequest) {
    return this.readinessService.assessDraft(
      request.user.sub,
      id,
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  @Get('brief-drafts/:id/publication-preview')
  previewConfluencePublication(
    @Param('id', parseUuid) id: string,
    @Req() request: WorkBriefRequest,
  ) {
    return this.publicationService.previewConfluence(
      request.user.sub,
      id,
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  @Post('brief-drafts/:id/publish')
  publish(
    @Param('id', parseUuid) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: PublishBriefDraftDto,
    @Req() request: WorkBriefRequest,
  ) {
    return this.publicationService.publish(
      request.user.sub,
      id,
      {
        draftVersion: dto.draftVersion,
        approved: dto.approved,
        previewHash: dto.previewHash,
        approvalRevision: dto.approvalRevision,
        idempotencyKey,
      },
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  @Get('brief-drafts/:id/publication')
  publication(@Param('id', parseUuid) id: string, @Req() request: WorkBriefRequest) {
    return this.publicationService.findLatest(request.user.sub, id);
  }

  @Get('brief-drafts/:id/publication/:publicationId/jira-preview')
  previewJiraPublication(
    @Param('id', parseUuid) id: string,
    @Param('publicationId', parseUuid) publicationId: string,
    @Req() request: WorkBriefRequest,
  ) {
    return this.publicationService.previewJira(
      request.user.sub,
      id,
      publicationId,
    );
  }

  @Post('brief-drafts/:id/publication/:publicationId/jira')
  publishJira(
    @Param('id', parseUuid) id: string,
    @Param('publicationId', parseUuid) publicationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: PublishBriefDraftDto,
    @Req() request: WorkBriefRequest,
  ) {
    return this.publicationService.publishJira(
      request.user.sub,
      id,
      publicationId,
      {
        draftVersion: dto.draftVersion,
        approved: dto.approved,
        previewHash: dto.previewHash,
        approvalRevision: dto.approvalRevision,
        idempotencyKey,
      },
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  @Get('brief-drafts/:id/publication/:publicationId/child-tasks-preview')
  previewChildTaskPublication(
    @Param('id', parseUuid) id: string,
    @Param('publicationId', parseUuid) publicationId: string,
    @Req() request: WorkBriefRequest,
  ) {
    return this.publicationService.previewChildTasks(
      request.user.sub,
      id,
      publicationId,
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  @Post('brief-drafts/:id/publication/:publicationId/child-tasks')
  publishChildTasks(
    @Param('id', parseUuid) id: string,
    @Param('publicationId', parseUuid) publicationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: PublishBriefDraftDto,
    @Req() request: WorkBriefRequest,
  ) {
    return this.publicationService.publishChildTasks(
      request.user.sub,
      id,
      publicationId,
      {
        draftVersion: dto.draftVersion,
        approved: dto.approved,
        previewHash: dto.previewHash,
        approvalRevision: dto.approvalRevision,
        idempotencyKey,
      },
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  @Post('brief-drafts/:id/publication/:publicationId/retry')
  retryPublication(
    @Param('id', parseUuid) id: string,
    @Param('publicationId', parseUuid) publicationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: RetryPublicationDto,
    @Req() request: WorkBriefRequest,
  ) {
    return this.publicationService.retry(
      request.user.sub,
      id,
      publicationId,
      {
        phase: dto.phase,
        draftVersion: dto.draftVersion,
        approved: dto.approved,
        previewHash: dto.previewHash,
        approvalRevision: dto.approvalRevision,
        idempotencyKey,
      },
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  @Patch('brief-drafts/:id')
  update(
    @Param('id', parseUuid) id: string,
    @Body() dto: UpdateBriefDraftDto,
    @Req() request: WorkBriefRequest,
  ) {
    return this.workBriefsService.updateDraft(request.user.sub, id, dto);
  }

  @Post('brief-drafts/:id/regenerate')
  regenerate(
    @Param('id', parseUuid) id: string,
    @Body() dto: RegenerateBriefDraftDto,
    @Req() request: WorkBriefRequest,
  ) {
    return this.workBriefsService.regenerateDraft(
      request.user.sub,
      id,
      dto,
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  @Post('brief-drafts/:id/refresh')
  refresh(
    @Param('id', parseUuid) id: string,
    @Body() dto: RefreshBriefDraftDto,
    @Req() request: WorkBriefRequest,
  ) {
    return this.workBriefsService.refreshDraft(
      request.user.sub,
      id,
      dto,
      request.correlationId ?? 'missing-correlation-id',
    );
  }
}
