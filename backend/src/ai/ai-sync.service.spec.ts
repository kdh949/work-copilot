import { AiSyncService } from './ai-sync.service';
import { AiSyncOutbox } from './ai-sync-outbox.entity';
import { AiService } from './ai.service';
import { Post } from '../posts/post.entity';

describe('AiSyncService', () => {
    function makeService(job: AiSyncOutbox, syncPost = jest.fn().mockResolvedValue(undefined)) {
        const outboxRepository = {
            find: jest.fn().mockResolvedValue([job]),
            save: jest.fn().mockImplementation(async (value) => value),
            update: jest.fn(),
        };
        const postRepository = {
            findOne: jest.fn().mockResolvedValue({ id: 1, sourceId: job.sourceId } as Post),
        };
        const aiService = {
            syncPost,
            deletePost: jest.fn().mockResolvedValue(undefined),
        };

        return {
            service: new AiSyncService(outboxRepository as never, postRepository as never, aiService as AiService),
            outboxRepository,
            aiService,
        };
    }

    it('marks a successful document upsert job as completed', async () => {
        const job = {
            id: 1,
            sourceId: 'wiki-1',
            operation: 'upsert',
            status: 'pending',
            attempts: 0,
            nextAttemptAt: new Date(),
        } as AiSyncOutbox;
        const { service, aiService } = makeService(job);

        await service.processPendingJobs();

        expect(aiService.syncPost).toHaveBeenCalled();
        expect(job.status).toBe('completed');
        expect(job.lastError).toBeNull();
    });

    it('keeps a failed job for a later retry with an increased attempt count', async () => {
        const job = {
            id: 1,
            sourceId: 'wiki-1',
            operation: 'upsert',
            status: 'pending',
            attempts: 0,
            nextAttemptAt: new Date(),
        } as AiSyncOutbox;
        const { service } = makeService(job, jest.fn().mockRejectedValue(new Error('AI unavailable')));

        await service.processPendingJobs();

        expect(job.status).toBe('retry');
        expect(job.attempts).toBe(1);
        expect(job.lastError).toBe('AI unavailable');
        expect(job.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    });
});
