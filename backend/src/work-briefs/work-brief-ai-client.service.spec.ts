import { ServiceUnavailableException } from '@nestjs/common';
import { WorkBriefAiClientService } from './work-brief-ai-client.service';

const validOutput = {
  title: '배포 준비',
  summary: '테스트를 완료합니다.',
  keyPoints: ['요구사항 검토'],
  risks: ['일정'],
  nextSteps: ['검증'],
  evidenceIds: ['jira:DEMO-1'],
};

describe('WorkBriefAiClientService', () => {
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'AI_SERVICE_URL') {
        return 'http://ai-service.test';
      }
      if (key === 'AI_SERVICE_API_KEY') {
        return 'internal-service-key';
      }
      return undefined;
    }),
  };
  const contentGuard = {
    assertSafeRequest: jest.fn(),
    assertSafeModelOutput: jest.fn(),
  };
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('uses only the isolated work-brief endpoint and validates citations', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(validOutput),
    });
    global.fetch = fetchMock;
    const service = new WorkBriefAiClientService(
      configService as never,
      contentGuard as never,
    );

    await expect(
      service.generate('create a brief', [
        { evidenceId: 'jira:DEMO-1', content: 'masked upstream only' },
      ]),
    ).resolves.toEqual(validOutput);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://ai-service.test/work-brief/generate',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(contentGuard.assertSafeModelOutput).toHaveBeenCalled();
  });

  it('does not return a model result that cites unrequested evidence', async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        ...validOutput,
        evidenceIds: ['confluence:forbidden'],
      }),
    });
    const service = new WorkBriefAiClientService(
      configService as never,
      contentGuard as never,
    );

    await expect(
      service.generate('create a brief', [
        { evidenceId: 'jira:DEMO-1', content: 'masked upstream only' },
      ]),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('uses the isolated DLP endpoint to sanitize an edited draft', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ values: ['담당자 [EMAIL_1]'] }),
    });
    global.fetch = fetchMock;
    const service = new WorkBriefAiClientService(
      configService as never,
      contentGuard as never,
    );

    await expect(
      service.sanitize(['담당자 user@example.com']),
    ).resolves.toEqual(['담당자 [EMAIL_1]']);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://ai-service.test/work-brief/sanitize',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
