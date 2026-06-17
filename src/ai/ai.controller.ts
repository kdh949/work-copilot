import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AiService } from "./ai.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AiChatDto } from "./dto/ai-chat.dto";
import { AiOnboardingDto } from "./dto/ai-onboarding.dto";

@Controller('ai')
export class AiController {
    constructor(private readonly aiService: AiService) {}

    @UseGuards(JwtAuthGuard)
    @Post('chat')
    chat(@Body() aiChatDto: AiChatDto) {
        return this.aiService.chat(aiChatDto);
    }

    @UseGuards(JwtAuthGuard)
    @Post('onboarding')
    onboarding(@Body() aiOnboardingDto: AiOnboardingDto) {
        return this.aiService.onboarding(aiOnboardingDto);
    }

    @UseGuards(JwtAuthGuard)
    @Post('lecture')
    lecture(@Body() aiOnboardingDto: AiOnboardingDto) {
        return this.aiService.lecture(aiOnboardingDto);
    }

    @UseGuards(JwtAuthGuard)
    @Post('agent')
    agent(@Body() aiChatDto: AiChatDto) {
        return this.aiService.agent(aiChatDto);
    }
}
