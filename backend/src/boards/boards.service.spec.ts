import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { BoardsService } from './boards.service';
import { Board } from './entities/board.entity';
import { Tag } from './entities/tag.entity';
import { AiService } from '../ai/ai.service';

describe('BoardsService', () => {
  let service: BoardsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BoardsService,
        { provide: getRepositoryToken(Board), useValue: {} },
        { provide: getRepositoryToken(Tag), useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: AiService, useValue: { indexBoardDocument: jest.fn() } },
      ],
    }).compile();

    service = module.get<BoardsService>(BoardsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
