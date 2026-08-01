import {
  Body,
  Controller,
  Get,
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
  CreateBriefDraftDto,
  RefreshBriefDraftDto,
  UpdateBriefDraftDto,
} from './dto/brief-draft.dto';
import { WorkBriefsService } from './work-briefs.service';

type WorkBriefRequest = AuthenticatedRequest & CorrelatedRequest;

@Controller()
@UseGuards(SessionAuthGuard)
export class WorkBriefsController {
  constructor(private readonly workBriefsService: WorkBriefsService) {}

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
