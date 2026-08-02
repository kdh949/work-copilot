import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
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
  RefreshBriefDraftDto,
  UpdateBriefDraftDto,
} from './dto/brief-draft.dto';
import { WorkBriefsService } from './work-briefs.service';

type WorkBriefRequest = AuthenticatedRequest & CorrelatedRequest;

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

  @Get('brief-drafts/:id')
  find(@Param('id') id: string, @Req() request: WorkBriefRequest) {
    return this.workBriefsService.findDraft(request.user.sub, id);
  }

  @Get('brief-drafts/:id/readiness')
  readiness(@Param('id') id: string, @Req() request: WorkBriefRequest) {
    return this.readinessService.assessDraft(
      request.user.sub,
      id,
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  @Post('brief-drafts/:id/publish')
  publish(
    @Param('id') id: string,
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
        idempotencyKey,
      },
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  @Get('brief-drafts/:id/publication')
  publication(@Param('id') id: string, @Req() request: WorkBriefRequest) {
    return this.publicationService.findLatest(request.user.sub, id);
  }

  @Post('brief-drafts/:id/publication/:publicationId/retry')
  retryPublication(
    @Param('id') id: string,
    @Param('publicationId') publicationId: string,
    @Body() dto: RetryPublicationDto,
    @Req() request: WorkBriefRequest,
  ) {
    return this.publicationService.retry(
      request.user.sub,
      id,
      publicationId,
      { draftVersion: dto.draftVersion, approved: dto.approved },
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  @Patch('brief-drafts/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBriefDraftDto,
    @Req() request: WorkBriefRequest,
  ) {
    return this.workBriefsService.updateDraft(request.user.sub, id, dto);
  }

  @Post('brief-drafts/:id/refresh')
  refresh(
    @Param('id') id: string,
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
