import { Delete, Injectable, NotFoundException } from '@nestjs/common';
import { CreatePostDto } from "./dto/create-post.dto";
import { UpdatePostDto } from "./dto/update-post.dto";
import { InjectRepository } from "@nestjs/typeorm";
import { ILike, Repository } from "typeorm";
import { Post } from "./post.entity";

// import {contains} from "class-validator"; // 타입 검증 미진행 (엔티티에서 할 예정)

@Injectable()
export class PostsService {
    constructor(
        @InjectRepository(Post) // Post Entity를 다루는 Repository를
        private readonly postRepository: Repository<Post> // PostsService 안에서 this.postRepository로 쓰겠다.
    ) { }

    async findAll(keyword?: string): Promise<Post[]> {
        if (!keyword) {
            return this.postRepository.find({
                order: {
                    id: 'DESC',
                },
            });
        }
        
        return this.postRepository.find({
            where: {
                title: ILike(`%${keyword}%`),
            },
            order: {
                id: 'DESC',
            },
        });
    }

    async findOne(id: number): Promise<Post> {
        const post = await this.postRepository.findOne({
            where: { id },
        });
        if (!post) {
            throw new NotFoundException('게시글을 찾을 수 없습니다.');
        }
        return post;
    }

    async create(createPostDto: CreatePostDto): Promise<Post> {
        const post = this.postRepository.create({
            title: createPostDto.title,
            content: createPostDto.content,
        });

        return this.postRepository.save(post);
    }

    async update(id: number, updatePostDto: UpdatePostDto): Promise<Post> {
        const post = await this.findOne(id);

        if (updatePostDto.title) {
            post.title = updatePostDto.title;
        }
        if (updatePostDto.content) {
            post.content = updatePostDto.content;
        }
        return post;
    }

    async remove(id: number): Promise<{ deleted: boolean }> {
        const post = await this.findOne(id);

        await this.postRepository.delete(post.id);

        return {
            deleted: true,
        };
    }
}
