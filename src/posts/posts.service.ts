import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { CreatePostDto } from "./dto/create-post.dto";
import { UpdatePostDto } from "./dto/update-post.dto";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Post } from "./post.entity";
import { UsersService } from "../users/users.service";
import { Comment } from "./comment.entity";
import { CreateCommentDto } from "./dto/create-comment.dto";
import { UpdateCommentDto } from "./dto/update-comment.dto";
import { AiService } from "../ai/ai.service";

// import {contains} from "class-validator"; // 타입 검증 미진행 (엔티티에서 할 예정)

type FindAllPostsOptions = {
    keyword?: string;
    page?: string;
    limit?: string;
    tag?: string;
    department?: string;
    boardType?: string;
    mine?: boolean;
    userId?: number;
    includeQuestions?: boolean;
};

type PagedPostsResponse = {
    items: Post[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
};

@Injectable()
export class PostsService {
    constructor(
        @InjectRepository(Post) // Post Entity를 다루는 Repository를
        private readonly postRepository: Repository<Post>, // PostsService 안에서 this.postRepository로 쓰겠다.
        @InjectRepository(Comment)
        private readonly commentRepository: Repository<Comment>,
        private readonly usersService: UsersService,
        private readonly aiService: AiService,
    ) { }

    async findAll(options: FindAllPostsOptions): Promise<PagedPostsResponse> {
        const page = this.toNumber(options.page, 1);
        const limit = this.toNumber(options.limit, 5);

        const query = this.postRepository
            .createQueryBuilder('post')
            .leftJoinAndSelect('post.author', 'author')
            .leftJoinAndSelect('post.comments', 'comment')
            .leftJoinAndSelect('comment.author', 'commentAuthor')
            .orderBy('post.id', 'DESC')
            .addOrderBy('comment.id', 'ASC')
            .skip((page - 1) * limit)
            .take(limit);

        if (options.keyword) {
            query.andWhere('(post.title ILIKE :keyword OR post.content ILIKE :keyword)', {
                keyword: `%${options.keyword}%`,
            });
        }

        if (options.boardType) {
            if (options.boardType === 'note' && options.includeQuestions) {
                query.andWhere('(post.boardType = :boardType OR post.boardType = :questionType)', {
                    boardType: 'note',
                    questionType: 'question',
                });
            } else {
                query.andWhere('post.boardType = :boardType', {
                    boardType: options.boardType,
                });
            }
        }

        if (options.mine && options.userId) {
            query.andWhere('author.id = :userId', {
                userId: options.userId,
            });
        }

        if (options.department) {
            query.andWhere('post.department ILIKE :department', {
                department: `%${options.department}%`,
            });
        }

        if (options.tag) {
            query.andWhere('post.tags ILIKE :tag', {
                tag: `%${options.tag}%`,
            });
        }

        const [items, total] = await query.getManyAndCount();

        return {
            items,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    async findOne(id: number, userId?: number): Promise<Post> {
        const post = await this.postRepository.findOne({
            where: { id },
            relations: {
                author: true,
                comments: {
                    author: true,
                },
            }
        });
        if (!post) {
            throw new NotFoundException('게시글을 찾을 수 없습니다.');
        }

        if ((post.boardType === 'note' || post.boardType === 'question') && post.author.id !== userId) {
            throw new ForbiddenException('본인의 노트만 볼 수 있습니다.');
        }

        return post;
    }

    async create(createPostDto: CreatePostDto, authorId: number, userRole: string): Promise<Post> {
        this.checkAdmin(userRole);

        const author = await this.usersService.findByIdOrFail(authorId);

        const post = this.postRepository.create({
            title: createPostDto.title,
            content: createPostDto.content,
            boardType: 'wiki',
            department: this.normalizeDepartment(createPostDto.department),
            tags: this.normalizeTags(createPostDto.tags),
            author,
        });

        const savedPost = await this.postRepository.save(post);
        await this.aiService.syncPost(savedPost);

        return savedPost;
    }

    async createQuestion(createPostDto: CreatePostDto, authorId: number): Promise<Post> {
        return this.createNote(createPostDto, authorId);
    }

    async createNote(createPostDto: CreatePostDto, authorId: number): Promise<Post> {
        const author = await this.usersService.findByIdOrFail(authorId);

        const post = this.postRepository.create({
            title: createPostDto.title,
            content: createPostDto.content,
            boardType: 'note',
            department: this.normalizeDepartment(createPostDto.department),
            tags: this.normalizeTags(createPostDto.tags),
            author,
        });

        return this.postRepository.save(post);
    }

    async update(id: number, updatePostDto: UpdatePostDto, userId: number, userRole: string): Promise<Post> {
        const post = await this.findOne(id, userId);

        this.checkPostPermission(post, userId, userRole);

        if (updatePostDto.title) {
            post.title = updatePostDto.title;
        }
        if (updatePostDto.content) {
            post.content = updatePostDto.content;
        }
        if (updatePostDto.department) {
            post.department = this.normalizeDepartment(updatePostDto.department);
        }
        if (updatePostDto.tags) {
            post.tags = this.normalizeTags(updatePostDto.tags);
        }

        const savedPost = await this.postRepository.save(post);

        if (savedPost.boardType === 'wiki') {
            await this.aiService.syncPost(savedPost);
        }

        return savedPost;
    }

    async remove(id: number, userId: number, userRole: string): Promise<{ deleted: boolean }> {
        const post = await this.findOne(id, userId);

        this.checkPostPermission(post, userId, userRole);

        await this.postRepository.delete(post.id);

        if (post.boardType === 'wiki') {
            await this.aiService.deletePost(post);
        }

        return {
            deleted: true,
        };
    }

    async createComment(postId: number, createCommentDto: CreateCommentDto, authorId: number): Promise<Comment> {
        const post = await this.findOne(postId, authorId);
        const author = await this.usersService.findByIdOrFail(authorId);

        const comment = this.commentRepository.create({
            content: createCommentDto.content,
            isAi: false,
            post,
            author,
        });

        return this.commentRepository.save(comment);
    }

    async updateComment(commentId: number, updateCommentDto: UpdateCommentDto, userId: number): Promise<Comment> {
        const comment = await this.findComment(commentId);

        this.checkCommentOwnership(comment, userId);

        comment.content = updateCommentDto.content;

        return this.commentRepository.save(comment);
    }

    async removeComment(commentId: number, userId: number, userRole: string): Promise<{ deleted: boolean }> {
        const comment = await this.findComment(commentId);

        this.checkCommentOwnership(comment, userId, userRole);

        await this.commentRepository.delete(comment.id);

        return {
            deleted: true,
        };
    }

    private checkOwnership(post: Post, userId: number): void {
        if (post.author.id !== userId) {
            throw new ForbiddenException('본인의 게시글만 수정/삭제할 수 있습니다.');
        }
    }

    private checkAdmin(userRole: string): void {
        if (userRole !== 'admin') {
            throw new ForbiddenException('관리자만 사용할 수 있습니다.');
        }
    }

    private checkPostPermission(post: Post, userId: number, userRole: string): void {
        if (post.boardType === 'wiki') {
            this.checkAdmin(userRole);
            return;
        }

        this.checkOwnership(post, userId);
    }

    private checkCommentOwnership(comment: Comment, userId: number, userRole = 'employee'): void {
        if (userRole === 'admin') {
            return;
        }

        if (!comment.author || comment.author.id !== userId) {
            throw new ForbiddenException('본인의 댓글만 수정/삭제할 수 있습니다.');
        }
    }

    private async findComment(commentId: number): Promise<Comment> {
        const comment = await this.commentRepository.findOne({
            where: { id: commentId },
            relations: {
                author: true,
                post: true,
            },
        });

        if (!comment) {
            throw new NotFoundException('댓글을 찾을 수 없습니다.');
        }

        return comment;
    }

    private normalizeTags(tags?: string[]): string[] {
        if (!tags) {
            return [];
        }

        return tags
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0);
    }

    private normalizeDepartment(department?: string): string {
        if (!department) {
            return '공통';
        }

        return department.trim() || '공통';
    }

    private toNumber(value: string | undefined, defaultValue: number): number {
        if (!value) {
            return defaultValue;
        }

        const numberValue = Number(value);

        if (Number.isNaN(numberValue) || numberValue < 1) {
            return defaultValue;
        }

        return numberValue;
    }
}
