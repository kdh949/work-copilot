import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateCommentDto } from './dto/create-comment.dto';
import { Comment } from './entities/comment.entity';
import { AiService } from '../ai/ai.service';
import { JwtService } from '@nestjs/jwt';

type JwtPayload = {
  sub: number;
  loginId: string;
};

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private readonly commentsRepository: Repository<Comment>,
    private readonly aiService: AiService,
    private readonly jwtService: JwtService,
  ) {}

  private async getUserFromToken(token: string) {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('토큰이 유효하지 않습니다.');
    }
  }

  private toCommentResponse(comment: Comment) {
    const writer = comment.user?.loginId ?? comment.writer;

    return {
      id: comment.id,
      boardId: comment.boardId,
      content: comment.content,
      userId: comment.userId,
      writer,
    };
  }

  findByBoardId(boardId: number) {
    return this.commentsRepository.find({
      where: { boardId },
      relations: { user: true },
      order: { id: 'ASC' },
    }).then((comments) => comments.map((comment) => this.toCommentResponse(comment)));
  }

  async findRecent() {
    const comments = await this.commentsRepository.find({
      relations: { board: true, user: true },
      order: { id: 'DESC' },
      take: 5,
    });

    return comments.map((comment) => ({
      id: comment.id,
      boardId: comment.boardId,
      boardTitle: comment.board?.title ?? '',
      content: comment.content,
      writer: comment.user?.loginId ?? comment.writer,
    }));
  }

  async findMine(token: string) {
    const user = await this.getUserFromToken(token);
    const comments = await this.commentsRepository.find({
      where: [{ userId: user.sub }, { writer: user.loginId }],
      relations: { board: true, user: true },
      order: { id: 'DESC' },
      take: 50,
    });

    return comments.map((comment) => ({
      ...this.toCommentResponse(comment),
      boardTitle: comment.board?.title ?? '',
    }));
  }

  async create(createCommentDto: CreateCommentDto, token: string) {
    const user = await this.getUserFromToken(token);
    // Typeorm 형식의 객체로 만든다
    // 나중에 저장 전에 값을 추가/수정하기 쉽다
    const comment = this.commentsRepository.create({
      ...createCommentDto,
      // 댓글 작성자도 클라이언트 body가 아니라 검증된 JWT payload로만 정합니다.
      userId: user.sub,
      writer: user.loginId,
    });
    const saved = await this.commentsRepository.save(comment);

    // 댓글 저장 직후 해당 댓글만 인덱싱합니다. 실패해도 댓글 저장은 유지합니다.
    void this.aiService
      .indexCommentDocument({
        id: saved.id,
        boardId: saved.boardId,
        content: saved.content,
        writer: user.loginId,
      })
      .catch((error: unknown) => {
        console.warn(`[comment-index] failed: ${String(error)}`);
      });

    return this.toCommentResponse(saved);
  }

  async remove(id: number, token: string) {
    const user = await this.getUserFromToken(token);
    const comment = await this.commentsRepository.findOne({
      where: { id },
      relations: { user: true },
    });

    if (!comment) {
      throw new NotFoundException('댓글을 찾을 수 없습니다.');
    }

    if (comment.userId !== user.sub && comment.writer !== user.loginId) {
      throw new ForbiddenException('작성자만 삭제할 수 있습니다.');
    }

    return this.commentsRepository.delete({ id });
  }
}
