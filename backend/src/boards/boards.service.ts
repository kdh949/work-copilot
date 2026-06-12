import { Injectable } from '@nestjs/common';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';
import { Board } from './entities/board.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Injectable()
export class BoardsService {
  constructor(
    // Board는 엔티티 클래스가 들어온다
    @InjectRepository(Board)
    private readonly boardsRepository: Repository<Board>,
  ) {}

  async create(createBoardDto: CreateBoardDto) {
    const board = this.boardsRepository.create(createBoardDto);
    return this.boardsRepository.save(board);
  }

  findAll() {
    return this.boardsRepository.find();
  }

  findOne(id: number) {
    return this.boardsRepository.findOneBy({ id });
  }

  update(id: number, updateBoardDto: UpdateBoardDto) {
    // update(조건, 바꿀데이터)
    return this.boardsRepository.update({ id }, updateBoardDto);
  }

  remove(id: number) {
    return this.boardsRepository.delete({ id });
  }
}
