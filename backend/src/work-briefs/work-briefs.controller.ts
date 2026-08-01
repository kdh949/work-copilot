import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { GenerateWorkBriefDto } from './dto/generate-work-brief.dto';
import { WorkBriefsService } from './work-briefs.service';

@Controller('work-briefs')
@UseGuards(SessionAuthGuard)
export class WorkBriefsController {
  constructor(private readonly workBriefsService: WorkBriefsService) {}

  @Post('generate')
  generate(@Body() dto: GenerateWorkBriefDto) {
    return this.workBriefsService.generate(dto);
  }
}
