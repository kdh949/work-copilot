import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateCommentDto } from './dto/create-comment.dto';
import { Comment } from './entities/comment.entity';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private readonly commentsRepository: Repository<Comment>,
  ) {}

  findByBoardId(boardId: number) {
    return this.commentsRepository.find({
      where: { boardId },
      order: { id: 'ASC' },
    });
  }

  create(createCommentDto: CreateCommentDto) {
    // Typeorm 형식의 객체로 만든다
    // 나중에 저장 전에 값을 추가/수정하기 쉽다
    const comment = this.commentsRepository.create(createCommentDto);
    return this.commentsRepository.save(comment);
  }

  remove(id: number) {
    return this.commentsRepository.delete({ id });
  }
}
