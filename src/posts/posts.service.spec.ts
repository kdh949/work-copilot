import { Test, TestingModule } from '@nestjs/testing';
import { PostsService } from './posts.service';
import { getRepositoryToken } from "@nestjs/typeorm";
import { Post } from "./post.entity";
import { Comment } from "./comment.entity";
import { UsersService } from "../users/users.service";
import { AiService } from "../ai/ai.service";

describe('PostsService', () => {
  let service: PostsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsService,
        {
          provide: getRepositoryToken(Post),
          useValue: {},
        },
        {
          provide: getRepositoryToken(Comment),
          useValue: {},
        },
        {
          provide: UsersService,
          useValue: {},
        },
        {
          provide: AiService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<PostsService>(PostsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
