import { AiService } from './ai.service';
import { UsersService } from '../users/users.service';
import { ConfigService } from '@nestjs/config';
import { Post } from '../posts/post.entity';

describe('AiService', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('sends the internal service key when calling the AI service', async () => {
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ answer: '답변', sources: [] }),
        });
        global.fetch = fetchMock as typeof fetch;
        const service = new AiService(
            { get: jest.fn((key: string) => ({
                AI_SERVICE_URL: 'http://ai-service',
                AI_SERVICE_API_KEY: 'service-key',
            })[key]) } as unknown as ConfigService,
            { findById: jest.fn().mockResolvedValue({ role: 'employee', department: '엔지니어링' }) } as unknown as UsersService,
            { find: jest.fn() } as never,
        );

        await service.chat({ question: '온보딩 안내' }, 1);

        expect(fetchMock).toHaveBeenCalledWith('http://ai-service/chat', expect.objectContaining({
            headers: expect.objectContaining({
                'X-AI-Service-Key': 'service-key',
            }),
        }));
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
            question: '온보딩 안내',
            access: {
                role: 'employee',
                department: '엔지니어링',
            },
        });
    });

    it('uses an employee department instead of a client supplied onboarding department', async () => {
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ answer: '답변', sources: [] }),
        });
        global.fetch = fetchMock as typeof fetch;
        const service = new AiService(
            { get: jest.fn((key: string) => ({
                AI_SERVICE_URL: 'http://ai-service',
                AI_SERVICE_API_KEY: 'service-key',
            })[key]) } as unknown as ConfigService,
            { findById: jest.fn().mockResolvedValue({ role: 'employee', department: '엔지니어링' }) } as unknown as UsersService,
            { find: jest.fn() } as never,
        );

        await service.onboarding({ department: '인사' }, 1);

        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
            department: '엔지니어링',
            access: {
                role: 'employee',
                department: '엔지니어링',
            },
        });
    });
});
