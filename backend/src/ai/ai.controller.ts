import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AiService } from './ai.service';
import { AskAiDto } from './dto/ask-ai.dto';
import { SyncBlogsDto } from './dto/sync-blogs.dto';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('db/init')
  initVectorDb() {
    // 테스트 1단계입니다.
    // NestJS -> FastAPI /db/init -> vector DB 테이블 준비
    return this.aiService.initVectorDb();
  }

  @Post('blogs/sync')
  syncBlogs(@Body() syncBlogsDto: SyncBlogsDto) {
    // 테스트 2단계입니다.
    // NestJS -> FastAPI /blogs/sync -> 블로그 검색 -> chunk -> embedding -> DB 저장
    return this.aiService.syncBlogs(syncBlogsDto);
  }

  @Post('ask')
  ask(@Body() askAiDto: AskAiDto) {
    // 테스트 3단계입니다.
    // NestJS -> FastAPI /ask -> Agent가 RAG/MCP/LLM 중 필요한 도구를 골라 답변
    return this.aiService.ask(askAiDto);
  }

  @Get('knowledge/summary')
  getKnowledgeSummary() {
    return this.aiService.getKnowledgeSummary();
  }

  @Get('knowledge/resources')
  getKnowledgeResources(@Query('kind') kind = 'blog') {
    const safeKind = ['blog', 'official', 'board', 'comment'].includes(kind)
      ? (kind as 'blog' | 'official' | 'board' | 'comment')
      : 'blog';

    return this.aiService.getKnowledgeResources(safeKind);
  }
}
