import { Injectable } from '@nestjs/common';
import { ConfigService } from "@nestjs/config";
import { Post } from "../posts/post.entity";
import { AiChatDto } from "./dto/ai-chat.dto";
import { AiOnboardingDto } from "./dto/ai-onboarding.dto";
import { UsersService } from "../users/users.service";
import { InjectRepository } from "@nestjs/typeorm";
import { FindOptionsWhere, In, Repository } from "typeorm";

type AiDocument = {
    sourceId: string;
    title: string;
    content: string;
    department: string;
    tags: string[];
};

type AiSource = {
    sourceId: string;
    title: string;
    department: string;
    postId?: number | null;
};

type AiChatResponse = {
    answer?: string;
    searchMode?: string;
    department?: string | null;
    sources?: AiSource[];
    [key: string]: unknown;
};

@Injectable()
export class AiService {
    constructor(
        private readonly configService: ConfigService,
        private readonly usersService: UsersService,
        @InjectRepository(Post)
        private readonly postRepository: Repository<Post>,
    ) {}

    async chat(aiChatDto: AiChatDto, userId?: number) {
        const user = userId ? await this.usersService.findById(userId) : null;

        const response = await this.postToAi('/chat', {
            question: aiChatDto.question,
            userDepartment: user?.department || aiChatDto.department,
        }) as AiChatResponse;

        return this.enrichSourcesWithPostIds(response);
    }

    async onboarding(aiOnboardingDto: AiOnboardingDto) {
        return this.postToAi('/onboarding', aiOnboardingDto);
    }

    async lecture(aiOnboardingDto: AiOnboardingDto) {
        return this.postToAi('/lecture', aiOnboardingDto);
    }

    async agent(aiChatDto: AiChatDto) {
        return this.postToAi('/agent/run', aiChatDto);
    }

    async syncPost(post: Post): Promise<void> {
        const document: AiDocument = {
            sourceId: this.getPostSourceId(post),
            title: post.title,
            content: post.content,
            department: post.department || '공통',
            tags: post.tags || [],
        };

        try {
            await this.postToAi('/documents', document);
        } catch (error) {
            console.log('AI 문서 동기화 실패', error);
        }
    }

    async deletePost(post: Post): Promise<void> {
        try {
            await fetch(`${this.getAiUrl()}/documents/${this.getPostSourceId(post)}`, {
                method: 'DELETE',
            });
        } catch (error) {
            console.log('AI 문서 삭제 동기화 실패', error);
        }
    }

    private async postToAi(path: string, body: object) {
        try {
            const response = await fetch(`${this.getAiUrl()}${path}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                return {
                    answer: 'AI 서비스에 연결하지 못했습니다. FastAPI 서버 실행 상태를 확인해주세요.',
                    statusCode: response.status,
                };
            }

            return response.json();
        } catch {
            return {
                answer: 'AI 서비스에 연결하지 못했습니다. FastAPI 서버 실행 상태를 확인해주세요.',
            };
        }
    }

    private getAiUrl(): string {
        const aiUrl = this.configService.get<string>('AI_SERVICE_URL') || 'http://localhost:8000';

        if (aiUrl.startsWith('http')) {
            return aiUrl;
        }

        return `https://${aiUrl}`;
    }

    private getPostSourceId(post: Post): string {
        return post.sourceId || `post-${post.id}`;
    }

    private async enrichSourcesWithPostIds(response: AiChatResponse): Promise<AiChatResponse> {
        if (!Array.isArray(response.sources) || response.sources.length === 0) {
            return response;
        }

        const sourceIds = [...new Set(response.sources.map((source) => source.sourceId).filter(Boolean))];
        const fallbackPostIds = sourceIds
            .map((sourceId) => /^post-(\d+)$/.exec(sourceId)?.[1])
            .filter((postId): postId is string => Boolean(postId))
            .map((postId) => Number(postId));
        const whereConditions: FindOptionsWhere<Post>[] = [];

        if (sourceIds.length > 0) {
            whereConditions.push({ sourceId: In(sourceIds) });
        }

        if (fallbackPostIds.length > 0) {
            whereConditions.push({ id: In(fallbackPostIds) });
        }

        if (whereConditions.length === 0) {
            return response;
        }

        const posts = await this.postRepository.find({
            select: {
                id: true,
                sourceId: true,
            },
            where: whereConditions,
        });
        const postIdBySourceId = new Map<string, number>();

        for (const post of posts) {
            postIdBySourceId.set(`post-${post.id}`, post.id);

            if (post.sourceId) {
                postIdBySourceId.set(post.sourceId, post.id);
            }
        }

        return {
            ...response,
            sources: response.sources.map((source) => ({
                ...source,
                postId: postIdBySourceId.get(source.sourceId) || null,
            })),
        };
    }
}
