import {Injectable, NotFoundException, Post} from '@nestjs/common';
import {CreatePostDto} from "./dto/create-post.dto";
import {UpdatePostDto} from "./dto/update-post.dto";
import * as timers from "node:timers";
import * as string_decoder from "node:string_decoder";
import {reportUnhandledError} from "rxjs/internal/util/reportUnhandledError";
import {contains} from "class-validator";

export type PostItem = {
    id: number;
    title: string;
    content: string;
};

@Injectable()
export class PostsService {
    private posts: PostItem[] = [
        {
            id: 1,
            title: '첫 번째 글',
            content: '내용입니다.',
        },
    ];

    findAll(keyword?: string): PostItem[] {
        if (!keyword) {
            return this.posts;
        }

        return this.posts.filter((post) => post.title.includes(keyword));
    }

    findOne(id: Number): PostItem {
        const post = this.posts.find((post) => post.id === id);
        if (!post) {
            throw new NotFoundException('게시글을 찾을 수 없습니다.');
        }
        return post;
    }

    create(createPostDto: CreatePostDto): PostItem {
        const post: PostItem = {
            id: this.posts.length + 1,
            title: createPostDto.title,
            content: createPostDto.content,
        };

        this.posts.push(post);

        return post;
    }

    update(
        id: number,
        body: { title?: string; content?: string },
    ): PostItem | undefined {
        const post = this.findOne(id);

        if (!post) {
            return undefined;
        }

        if (body.title) {
            post.title = body.title;
        }

        if (body.content) {
            post.content = body.content;
        }

        return post;
    }

    remove(id: number): { deleted: boolean } {
        const beforeLength = this.posts.length;

        this.posts = this.posts.filter((post) => post.id !== id);

        return {
            deleted: this.posts.length < beforeLength,
        };
    }
}

