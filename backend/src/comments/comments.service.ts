import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateCommentDto } from './dto/create-comment.dto';
import { Comment } from './entities/comment.entity';
import { AiService } from '../ai/ai.service';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private readonly commentsRepository: Repository<Comment>,
    private readonly aiService: AiService,
  ) {}

  findByBoardId(boardId: number) {
    return this.commentsRepository.find({
      where: { boardId },
      order: { id: 'ASC' },
    });
  }

  async findRecent() {
    const comments = await this.commentsRepository.find({
      relations: { board: true },
      order: { id: 'DESC' },
      take: 5,
    });

    return comments.map((comment) => ({
      id: comment.id,
      boardId: comment.boardId,
      boardTitle: comment.board?.title ?? '',
      content: comment.content,
      writer: comment.writer,
    }));
  }

  async create(createCommentDto: CreateCommentDto) {
    // Typeorm 형식의 객체로 만든다
    // 나중에 저장 전에 값을 추가/수정하기 쉽다
    const comment = this.commentsRepository.create(createCommentDto);
    const saved = await this.commentsRepository.save(comment);

    // 댓글 저장 직후 해당 댓글만 인덱싱합니다. 실패해도 댓글 저장은 유지합니다.
    void this.aiService
      .indexCommentDocument({
        id: saved.id,
        boardId: saved.boardId,
        content: saved.content,
        writer: saved.writer,
      })
      .catch((error: unknown) => {
        console.warn(`[comment-index] failed: ${String(error)}`);
      });

    return saved;
  }

  remove(id: number) {
    return this.commentsRepository.delete({ id });
  }
}
