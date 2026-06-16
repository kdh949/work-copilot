import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AskAiDto } from './dto/ask-ai.dto';
import { SyncBlogsDto } from './dto/sync-blogs.dto';

@Injectable()
export class AiService {
  private readonly aiServerUrl: string;

  constructor(private readonly configService: ConfigService) {
    // NestJS가 FastAPI AI 서버를 찾을 주소입니다.
    // .env에 AI_SERVER_URL이 없으면 로컬 기본 주소를 사용합니다.
    this.aiServerUrl =
      this.configService.get<string>('AI_SERVER_URL') ?? 'http://localhost:8000';
  }

  private async postToAiServer(path: string, body: unknown) {
    // FastAPI 서버에 POST 요청을 보내는 공통 함수입니다.
    // 같은 코드가 여러 API에 반복되지 않게 한 곳에 모았습니다.
    const response = await fetch(`${this.aiServerUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      // AI 서버가 실패하면 NestJS도 실패를 알려줍니다.
      // 사용자는 "AI 서버 쪽에서 문제가 났구나"라고 알 수 있습니다.
      throw new BadGatewayException({
        message: 'AI 서버 요청에 실패했습니다.',
        status: response.status,
        detail: data,
      });
    }

    return data;
  }

  initVectorDb() {
    // 1단계: FastAPI의 /db/init을 호출해서 RAG용 테이블을 준비합니다.
    return this.postToAiServer('/db/init', {});
  }

  syncBlogs(dto: SyncBlogsDto) {
    // 2단계: FastAPI의 /blogs/sync를 호출해서 블로그 검색 후 embedding 저장을 실행합니다.
    return this.postToAiServer('/blogs/sync', dto);
  }

  ask(dto: AskAiDto) {
    // 3단계: FastAPI의 /ask를 호출해서 RAG/Agent/MCP가 섞인 답변을 받습니다.
    return this.postToAiServer('/ask', {
      question: dto.question,
      limit: dto.limit,
      repository_url: dto.repositoryUrl,
    });
  }
}
