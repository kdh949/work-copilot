import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';
import { Board } from './entities/board.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';

type JwtPayload = {
  sub: number;
  loginId: string;
};

@Injectable()
export class BoardsService {
  constructor(
    // Board는 엔티티 클래스가 들어온다
    @InjectRepository(Board)
    private readonly boardsRepository: Repository<Board>,
    private readonly jwtService: JwtService,
  ) {}

  // 토큰에서 loginId 꺼내는 함수
  private async getLoginIdFromToken(token: string) {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      return payload.loginId;
    } catch {
      throw new UnauthorizedException('토큰이 유효하지 않습니다.');
    }
  }

  async create(createBoardDto: CreateBoardDto) {
    const board = this.boardsRepository.create(createBoardDto);
    return this.boardsRepository.save(board);
  }

  findAll() {
    return this.boardsRepository.find();
  }

  async findOne(id: number) {
    const board = await this.boardsRepository.findOneBy({ id });

    if (!board) {
      throw new NotFoundException('게시글을 찾을 수 없습니다.');
    }

    await this.addViewCount(id);

    return {
      ...board,
      viewCount: board.viewCount + 1,
    };
  }

  async update(id: number, updateBoardDto: UpdateBoardDto, token: string) {
    const loginId = await this.getLoginIdFromToken(token);
    const board = await this.boardsRepository.findOneBy({ id });

    if (!board) {
      throw new NotFoundException('게시글을 찾을 수 없습니다.');
    }

    if (board.writer !== loginId) {
      throw new ForbiddenException('작성자만 수정할 수 있습니다.');
    }

    // update(조건, 바꿀데이터)
    // 조건에는 {id:id} => { id }
    return this.boardsRepository.update({ id }, updateBoardDto);
  }

  async remove(id: number, token: string) {
    const loginId = await this.getLoginIdFromToken(token);
    const board = await this.boardsRepository.findOneBy({ id });

    if (!board) {
      throw new NotFoundException('게시글을 찾을 수 없습니다.');
    }

    if (board.writer !== loginId) {
      throw new ForbiddenException('작성자만 삭제할 수 있습니다.');
    }

    return this.boardsRepository.delete({ id });
  }

  addViewCount(id: number) {
    return this.boardsRepository.increment({ id }, 'viewCount', 1);
  }
}
