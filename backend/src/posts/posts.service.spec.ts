import { Test, TestingModule } from '@nestjs/testing';
import { PostsService } from './posts.service';
import { getRepositoryToken } from "@nestjs/typeorm";
import { Post } from "./post.entity";
import { Comment } from "./comment.entity";
import { UsersService } from "../users/users.service";
import { AiSyncService } from '../ai/ai-sync.service';
import { ForbiddenException } from '@nestjs/common';

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
          provide: AiSyncService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<PostsService>(PostsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('rejects a wiki detail request outside an employee department', async () => {
    const wikiPost = {
      id: 1,
      boardType: 'wiki',
      department: '인사',
      author: { id: 2 },
    } as Post;
    const protectedService = new PostsService(
      { findOne: jest.fn().mockResolvedValue(wikiPost) } as never,
      {} as never,
      {} as UsersService,
      {} as AiSyncService,
    );

    await expect(protectedService.findOne(1, {
      userId: 10,
      role: 'employee',
      department: '엔지니어링',
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an administrator to read any wiki detail', async () => {
    const wikiPost = {
      id: 1,
      boardType: 'wiki',
      department: '인사',
      author: { id: 2 },
    } as Post;
    const protectedService = new PostsService(
      { findOne: jest.fn().mockResolvedValue(wikiPost) } as never,
      {} as never,
      {} as UsersService,
      {} as AiSyncService,
    );

    await expect(protectedService.findOne(1, {
      userId: 10,
      role: 'admin',
      department: '엔지니어링',
    })).resolves.toBe(wikiPost);
  });
});
