import { Injectable } from '@nestjs/common';
import { GenerateWorkBriefDto } from './dto/generate-work-brief.dto';
import {
  WorkBriefAiClientService,
  type WorkBriefOutput,
} from './work-brief-ai-client.service';

@Injectable()
export class WorkBriefsService {
  constructor(private readonly aiClient: WorkBriefAiClientService) {}

  generate(dto: GenerateWorkBriefDto): Promise<WorkBriefOutput> {
    return this.aiClient.generate(dto.instruction, dto.evidence);
  }
}
