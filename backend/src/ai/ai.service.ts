import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AskAiDto } from './dto/ask-ai.dto';
import { SyncBlogsDto } from './dto/sync-blogs.dto';

type KnowledgeResourceKind = 'blog' | 'official' | 'board' | 'comment';

type KnowledgeSummary = {
  blogCount: number;
  officialCount: number;
  chunkCount: number;
  boardCount: number;
  commentCount: number;
};

type KnowledgeResource = {
  id: string;
  title: string;
  source: string;
  summary: string;
  status: string;
};

type BoardIndexPayload = {
  id: number;
  title: string;
  content: string;
  writer: string;
  tags?: string[];
};

type CommentIndexPayload = {
  id: number;
  boardId: number;
  content: string;
  writer: string;
  boardTitle?: string;
};

@Injectable()
export class AiService {
  private readonly aiServerUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {
    // NestJS가 FastAPI AI 서버를 찾을 주소입니다.
    // .env에 AI_SERVER_URL이 없으면 로컬 기본 주소를 사용합니다.
    const aiServerUrl =
      this.configService.get<string>('AI_SERVER_URL') ??
      'http://localhost:8000';
    this.aiServerUrl = /^https?:\/\//.test(aiServerUrl)
      ? aiServerUrl
      : `https://${aiServerUrl}`;
  }

  private async postToAiServer<TResponse = unknown>(
    path: string,
    body: unknown,
  ): Promise<TResponse> {
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
    const data = (text ? JSON.parse(text) : null) as unknown;

    if (!response.ok) {
      // AI 서버가 실패하면 NestJS도 실패를 알려줍니다.
      // 사용자는 "AI 서버 쪽에서 문제가 났구나"라고 알 수 있습니다.
      throw new BadGatewayException({
        message: 'AI 서버 요청에 실패했습니다.',
        status: response.status,
        detail: data,
      });
    }

    return data as TResponse;
  }

  private async queryRows<TRecord>(
    query: string,
    parameters?: unknown[],
  ): Promise<TRecord[]> {
    const rows = (await this.dataSource.query(query, parameters)) as unknown;

    return Array.isArray(rows) ? (rows as TRecord[]) : [];
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

  indexBoardDocument(board: BoardIndexPayload) {
    // 게시글 하나만 AI 서버에 보내 변경된 문서만 vector DB에 반영합니다.
    return this.postToAiServer('/index-text', {
      title: `게시글: ${board.title}`,
      content: [
        `게시글 제목: ${board.title}`,
        `작성자: ${board.writer}`,
        `태그: ${board.tags?.length ? board.tags.join(', ') : '없음'}`,
        '',
        board.content,
      ].join('\n'),
      source_type: 'BOARD',
      source_url: `board://${board.id}`,
      discovered_by: 'backend_board',
    });
  }

  indexCommentDocument(comment: CommentIndexPayload) {
    // 댓글 하나만 AI 서버에 보내 새 댓글만 즉시 검색 대상에 넣습니다.
    return this.postToAiServer('/index-text', {
      title: `댓글: ${comment.boardTitle ?? `게시글 #${comment.boardId}`} #${comment.id}`,
      content: [
        `댓글이 달린 게시글: ${comment.boardTitle ?? comment.boardId}`,
        `게시글 번호: ${comment.boardId}`,
        `댓글 작성자: ${comment.writer}`,
        '',
        comment.content,
      ].join('\n'),
      source_type: 'COMMENT',
      source_url: `comment://${comment.id}`,
      discovered_by: 'backend_comment',
    });
  }

  async getKnowledgeSummary(): Promise<KnowledgeSummary> {
    const documentRows = await this.queryRows<{
      blogCount: string;
      officialCount: string;
      chunkCount: string;
    }>(`
      select
        count(*) filter (where source_type = 'BLOG') as "blogCount",
        count(*) filter (where source_type in ('OFFICIAL', 'OFFICIAL_EXHIBITION')) as "officialCount",
        (select count(*) from ai_document_chunks) as "chunkCount"
      from ai_documents
    `);

    const boardRows = await this.queryRows<{
      boardCount: string;
      commentCount: string;
    }>(`
      select
        (select count(*) from board) as "boardCount",
        (select count(*) from comment) as "commentCount"
    `);

    const [documentCounts] = documentRows;
    const [boardCounts] = boardRows;

    return {
      blogCount: Number(documentCounts?.blogCount ?? 0),
      officialCount: Number(documentCounts?.officialCount ?? 0),
      chunkCount: Number(documentCounts?.chunkCount ?? 0),
      boardCount: Number(boardCounts?.boardCount ?? 0),
      commentCount: Number(boardCounts?.commentCount ?? 0),
    };
  }

  async getKnowledgeResources(
    kind: KnowledgeResourceKind,
  ): Promise<KnowledgeResource[]> {
    if (kind === 'blog' || kind === 'official') {
      const sourceTypes =
        kind === 'blog' ? ['BLOG'] : ['OFFICIAL', 'OFFICIAL_EXHIBITION'];

      const rows = await this.queryRows<KnowledgeResource>(
        `
          select
            id::text,
            title,
            coalesce(source_url, source_type) as source,
            left(regexp_replace(content, '\\s+', ' ', 'g'), 180) as summary,
            source_type as status
          from ai_documents
          where source_type = any($1)
          order by updated_at desc
          limit 20
        `,
        [sourceTypes],
      );

      return rows;
    }

    if (kind === 'board') {
      const rows = await this.queryRows<KnowledgeResource>(`
        select
          id::text,
          title,
          writer as source,
          left(regexp_replace(content, '\\s+', ' ', 'g'), 180) as summary,
          concat('조회수 ', "viewCount") as status
        from board
        order by id desc
        limit 20
      `);

      return rows;
    }

    const rows = await this.queryRows<KnowledgeResource>(`
      select
        c.id::text,
        coalesce(b.title, concat('게시글 #', c."boardId")) as title,
        c.writer as source,
        left(regexp_replace(c.content, '\\s+', ' ', 'g'), 180) as summary,
        '댓글' as status
      from comment c
      left join board b on b.id = c."boardId"
      order by c.id desc
      limit 20
    `);

    return rows;
  }
}
