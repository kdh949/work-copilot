import { Injectable } from '@nestjs/common';
import { ConfigService } from "@nestjs/config";
import { Post } from "../posts/post.entity";
import { AiChatDto } from "./dto/ai-chat.dto";
import { AiOnboardingDto } from "./dto/ai-onboarding.dto";

type AiDocument = {
    sourceId: string;
    title: string;
    content: string;
    department: string;
    tags: string[];
};

@Injectable()
export class AiService {
    constructor(private readonly configService: ConfigService) {}

    async chat(aiChatDto: AiChatDto) {
        return this.postToAi('/chat', aiChatDto);
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
}
