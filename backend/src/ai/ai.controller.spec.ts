import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiSyncService } from './ai-sync.service';

describe('AiController operations', () => {
  it('allows an administrator to requeue a failed synchronization job', async () => {
    const syncService = {
      retryFailed: jest.fn().mockResolvedValue(1),
    } as unknown as AiSyncService;
    const controller = new AiController({} as AiService, syncService);

    await expect(controller.retrySync('wiki-1')).resolves.toEqual({
      retried: 1,
    });
  });

  it('returns AI request and synchronization metrics to an administrator', async () => {
    const aiService = {
      operationsSummary: jest.fn().mockResolvedValue({ requests: 10 }),
    } as unknown as AiService;
    const syncService = {
      getSummary: jest.fn().mockResolvedValue({ completed: 8, retry: 1 }),
    } as unknown as AiSyncService;
    const controller = new AiController(aiService, syncService);

    await expect(controller.operationsSummary()).resolves.toEqual({
      requests: { requests: 10 },
      synchronization: { completed: 8, retry: 1 },
    });
  });
});
