import { ServiceUnavailableException } from '@nestjs/common';
import { WorkBriefAiClientService } from './work-brief-ai-client.service';

const validOutput = {
  schemaVersion: 2,
  title: { text: '배포 준비', evidenceIds: ['jira:DEMO-1'] },
  summary: { text: '테스트를 완료합니다.', evidenceIds: ['jira:DEMO-1'] },
  keyPoints: [{ text: '요구사항 검토', evidenceIds: ['jira:DEMO-1'] }],
  acceptanceCriteria: [
    { text: '요구사항이 검토되었다', evidenceIds: ['jira:DEMO-1'] },
  ],
  risks: [{ text: '일정', evidenceIds: ['jira:DEMO-1'] }],
  nextSteps: [{ text: '검증', evidenceIds: ['jira:DEMO-1'] }],
  childTasks: [
    {
      summary: '요구사항 검토',
      text: '요구사항을 검토한다',
      evidenceIds: ['jira:DEMO-1'],
    },
  ],
  excludedEvidence: [],
};

const requestedEvidence = [
  { evidenceId: 'jira:DEMO-1', content: 'masked upstream only' },
];

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

  it.each([
    [
      'an item citing unrequested evidence',
      {
        ...validOutput,
        risks: [{ text: '일정', evidenceIds: ['confluence:forbidden'] }],
      },
    ],
    [
      'an item with no evidence of its own',
      {
        ...validOutput,
        acceptanceCriteria: [{ text: '검토됨', evidenceIds: [] }],
      },
    ],
    [
      'evidence that is both cited and excluded',
      {
        ...validOutput,
        excludedEvidence: [
          { evidenceId: 'jira:DEMO-1', reason: '요구사항과 무관' },
        ],
      },
    ],
    [
      'a schema v1 response',
      {
        title: '배포 준비',
        summary: '테스트를 완료합니다.',
        keyPoints: ['요구사항 검토'],
        risks: ['일정'],
        nextSteps: ['검증'],
        evidenceIds: ['jira:DEMO-1'],
      },
    ],
  ])('rejects %s', async (_label, payload) => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(payload),
    });
    const service = new WorkBriefAiClientService(
      configService as never,
      contentGuard as never,
    );

    await expect(
      service.generate('create a brief', requestedEvidence),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it.each([
    [
      'a requirement without linked acceptance and child-task candidates',
      {
        ...validOutput,
        keyPoints: [
          { text: '요구사항 A', evidenceIds: ['jira:DEMO-1'] },
          { text: '요구사항 B', evidenceIds: ['jira:DEMO-2'] },
        ],
        acceptanceCriteria: [
          { text: 'A가 검증되었다', evidenceIds: ['jira:DEMO-1'] },
        ],
        childTasks: [
          {
            summary: 'A 작업',
            text: 'A를 수행한다',
            evidenceIds: ['jira:DEMO-1'],
          },
        ],
      },
    ],
    ['unaccounted requested evidence', validOutput],
    [
      'every item copies the entire requested evidence set',
      {
        schemaVersion: 2,
        title: {
          text: '배포 준비',
          evidenceIds: ['jira:DEMO-1', 'jira:DEMO-2'],
        },
        summary: {
          text: '테스트를 완료합니다.',
          evidenceIds: ['jira:DEMO-1', 'jira:DEMO-2'],
        },
        keyPoints: [
          {
            text: '요구사항 검토',
            evidenceIds: ['jira:DEMO-1', 'jira:DEMO-2'],
          },
        ],
        acceptanceCriteria: [
          {
            text: '요구사항이 검토되었다',
            evidenceIds: ['jira:DEMO-1', 'jira:DEMO-2'],
          },
        ],
        risks: [{ text: '일정', evidenceIds: ['jira:DEMO-1', 'jira:DEMO-2'] }],
        nextSteps: [
          { text: '검증', evidenceIds: ['jira:DEMO-1', 'jira:DEMO-2'] },
        ],
        childTasks: [
          {
            summary: '요구사항 검토',
            text: '요구사항을 검토한다',
            evidenceIds: ['jira:DEMO-1', 'jira:DEMO-2'],
          },
        ],
        excludedEvidence: [],
      },
    ],
  ])('rejects %s for multiple requested evidence', async (_label, payload) => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(payload),
    });
    const service = new WorkBriefAiClientService(
      configService as never,
      contentGuard as never,
    );

    await expect(
      service.generate('create a brief', [
        ...requestedEvidence,
        { evidenceId: 'jira:DEMO-2', content: 'another source' },
      ]),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('guards every model-authored string, including the schema v2 fields', async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        ...validOutput,
        excludedEvidence: [
          { evidenceId: 'jira:DEMO-2', reason: '요구사항과 무관' },
        ],
      }),
    });
    const service = new WorkBriefAiClientService(
      configService as never,
      contentGuard as never,
    );

    await service.generate('create a brief', [
      ...requestedEvidence,
      { evidenceId: 'jira:DEMO-2', content: 'unused evidence' },
    ]);

    const [[guarded]] = contentGuard.assertSafeModelOutput.mock
      .calls as unknown as [string[]][];
    for (const value of [
      '배포 준비',
      '테스트를 완료합니다.',
      '요구사항 검토',
      '요구사항이 검토되었다',
      '일정',
      '검증',
      '요구사항을 검토한다',
      '요구사항과 무관',
    ]) {
      expect(guarded).toContain(value);
    }
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
