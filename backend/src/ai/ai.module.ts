import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  // AI 관련 API 입구입니다.
  controllers: [AiController],
  // FastAPI AI 서버를 호출하는 일을 담당합니다.
  providers: [AiService],
})
export class AiModule {}
