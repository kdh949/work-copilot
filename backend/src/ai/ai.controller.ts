import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AiService } from './ai.service';
import { AiAccessContext } from './ai.service';
import {
  SessionAuthGuard,
  type AuthenticatedRequest,
} from '../auth/guards/session-auth.guard';
import { WorkCopilotAdminGuard } from '../auth/guards/work-copilot-admin.guard';
import { AiChatDto } from './dto/ai-chat.dto';
import { AiOnboardingDto } from './dto/ai-onboarding.dto';
import { AiSyncService } from './ai-sync.service';

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly aiSyncService: AiSyncService,
  ) {}

  @UseGuards(SessionAuthGuard)
  @Post('chat')
  chat(@Body() aiChatDto: AiChatDto, @Req() request: AuthenticatedRequest) {
    return this.aiService.chat(aiChatDto, this.getAccess(request));
  }

  @UseGuards(SessionAuthGuard)
  @Post('onboarding')
  onboarding(
    @Body() aiOnboardingDto: AiOnboardingDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.aiService.onboarding(aiOnboardingDto, this.getAccess(request));
  }

  @UseGuards(SessionAuthGuard)
  @Post('lecture')
  lecture(
    @Body() aiOnboardingDto: AiOnboardingDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.aiService.lecture(aiOnboardingDto, this.getAccess(request));
  }

  @UseGuards(SessionAuthGuard)
  @Post('agent')
  agent(@Body() aiChatDto: AiChatDto, @Req() request: AuthenticatedRequest) {
    return this.aiService.agent(aiChatDto, this.getAccess(request));
  }

  @UseGuards(SessionAuthGuard, WorkCopilotAdminGuard)
  @Post('operations/sync/:sourceId/retry')
  async retrySync(@Param('sourceId') sourceId: string) {
    return {
      retried: await this.aiSyncService.retryFailed(sourceId),
    };
  }

  @UseGuards(SessionAuthGuard, WorkCopilotAdminGuard)
  @Get('operations/summary')
  async operationsSummary() {
    const [requests, synchronization] = await Promise.all([
      this.aiService.operationsSummary(),
      this.aiSyncService.getSummary(),
    ]);

    return { requests, synchronization };
  }

  private getAccess(request: AuthenticatedRequest): AiAccessContext {
    return {
      role: request.user.role,
      department: request.user.department || '공통',
    };
  }
}
