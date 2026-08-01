import { ForbiddenException } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiSyncService } from './ai-sync.service';

describe('AiController operations', () => {
    it('allows an administrator to requeue a failed synchronization job', async () => {
        const syncService = { retryFailed: jest.fn().mockResolvedValue(1) } as unknown as AiSyncService;
        const controller = new AiController({} as AiService, syncService);

        await expect(controller.retrySync('wiki-1', {
            user: { sub: 1, role: 'admin', email: 'admin@example.com', department: '인사' },
        } as never)).resolves.toEqual({ retried: 1 });
    });

    it('rejects an employee retry request', async () => {
        const controller = new AiController({} as AiService, {} as AiSyncService);

        await expect(controller.retrySync('wiki-1', {
            user: { sub: 2, role: 'employee', email: 'employee@example.com', department: '엔지니어링' },
        } as never)).rejects.toBeInstanceOf(ForbiddenException);
    });
});
