import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AiService } from "./ai.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthenticatedRequest } from "../auth/guards/jwt-auth.guard";
import { AiChatDto } from "./dto/ai-chat.dto";
import { AiOnboardingDto } from "./dto/ai-onboarding.dto";
import { AiSyncService } from './ai-sync.service';

@Controller('ai')
export class AiController {
    constructor(
        private readonly aiService: AiService,
        private readonly aiSyncService: AiSyncService,
    ) {}

    @UseGuards(JwtAuthGuard)
    @Post('chat')
    chat(@Body() aiChatDto: AiChatDto, @Req() request: AuthenticatedRequest) {
        return this.aiService.chat(aiChatDto, request.user.sub);
    }

    @UseGuards(JwtAuthGuard)
    @Post('onboarding')
    onboarding(@Body() aiOnboardingDto: AiOnboardingDto, @Req() request: AuthenticatedRequest) {
        return this.aiService.onboarding(aiOnboardingDto, request.user.sub);
    }

    @UseGuards(JwtAuthGuard)
    @Post('lecture')
    lecture(@Body() aiOnboardingDto: AiOnboardingDto, @Req() request: AuthenticatedRequest) {
        return this.aiService.lecture(aiOnboardingDto, request.user.sub);
    }

    @UseGuards(JwtAuthGuard)
    @Post('agent')
    agent(@Body() aiChatDto: AiChatDto, @Req() request: AuthenticatedRequest) {
        return this.aiService.agent(aiChatDto, request.user.sub);
    }

    @UseGuards(JwtAuthGuard)
    @Post('operations/sync/:sourceId/retry')
    async retrySync(@Param('sourceId') sourceId: string, @Req() request: AuthenticatedRequest) {
        if (request.user.role !== 'admin') {
            throw new ForbiddenException('관리자만 AI 동기화를 재시도할 수 있습니다.');
        }

        return {
            retried: await this.aiSyncService.retryFailed(sourceId),
        };
    }

    @UseGuards(JwtAuthGuard)
    @Get('operations/summary')
    async operationsSummary(@Req() request: AuthenticatedRequest) {
        if (request.user.role !== 'admin') {
            throw new ForbiddenException('관리자만 AI 운영 지표를 조회할 수 있습니다.');
        }

        const [requests, synchronization] = await Promise.all([
            this.aiService.operationsSummary(),
            this.aiSyncService.getSummary(),
        ]);

        return { requests, synchronization };
    }
}
