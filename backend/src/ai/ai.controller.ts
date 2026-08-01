import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AiService } from "./ai.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthenticatedRequest } from "../auth/guards/jwt-auth.guard";
import { AiChatDto } from "./dto/ai-chat.dto";
import { AiOnboardingDto } from "./dto/ai-onboarding.dto";

@Controller('ai')
export class AiController {
    constructor(private readonly aiService: AiService) {}

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
}
