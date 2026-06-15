import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { CreatePostDto } from "./dto/create-post.dto";
import { UpdatePostDto } from "./dto/update-post.dto";
import { InjectRepository } from "@nestjs/typeorm";
import { Column, ILike, Repository } from "typeorm";
import { Post } from "./post.entity";
import { UsersService } from "../users/users.service";

// import {contains} from "class-validator"; // 타입 검증 미진행 (엔티티에서 할 예정)

@Injectable()
export class PostsService {
    constructor(
        @InjectRepository(Post) // Post Entity를 다루는 Repository를
        private readonly postRepository: Repository<Post>, // PostsService 안에서 this.postRepository로 쓰겠다.
        private readonly usersService: UsersService,
    ) { }

    async findAll(keyword?: string): Promise<Post[]> {
        if (!keyword) {
            return this.postRepository.find({
                relations: {
                    author: true, // Post를 조회할 때 author(User) 정보도 같이 가져오라는 뜻
                },
                order: {
                    id: 'DESC',
                },
            });
        }

        return this.postRepository.find({
            where: {
                title: ILike(`%${keyword}%`),
            },
            relations: {
                author: true,
            },
            order: {
                id: 'DESC',
            },
        });
    }

    async findOne(id: number): Promise<Post> {
        const post = await this.postRepository.findOne({
            where: { id },
            relations: {
                author: true,
            }
        });
        if (!post) {
            throw new NotFoundException('게시글을 찾을 수 없습니다.');
        }
        return post;
    }

    async create(createPostDto: CreatePostDto, authorId: number): Promise<Post> {
        const author = await this.usersService.findByIdOrFail(authorId);

        const post = this.postRepository.create({
            title: createPostDto.title,
            content: createPostDto.content,
            author,
        });

        return this.postRepository.save(post);
    }

    async update(id: number, updatePostDto: UpdatePostDto, userId: number): Promise<Post> {
        const post = await this.findOne(id);

        this.checkOwnership(post, userId);

        if (updatePostDto.title) {
            post.title = updatePostDto.title;
        }
        if (updatePostDto.content) {
            post.content = updatePostDto.content;
        }
        return this.postRepository.save(post);
    }

    async remove(id: number, userId: number): Promise<{ deleted: boolean }> {
        const post = await this.findOne(id);

        this.checkOwnership(post, userId);

        await this.postRepository.delete(post.id);

        return {
            deleted: true,
        };
    }

    private checkOwnership(post: Post, userId: number): void {
        if (post.author.id !== userId) {
            throw new ForbiddenException('본인의 게시글만 수정/삭제할 수 있습니다.');
        }
    }
}
