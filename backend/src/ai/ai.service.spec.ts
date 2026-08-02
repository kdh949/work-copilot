import { AiService } from './ai.service';
import { ConfigService } from '@nestjs/config';

const jsonResponse = (body: unknown): Response =>
  ({
    ok: true,
    json: () => Promise.resolve(body),
  }) as unknown as Response;

const getRequestBody = (
  fetchMock: jest.MockedFunction<typeof fetch>,
): string => {
  const options = getRequestOptions(fetchMock);
  const body = options.body;

  if (typeof body !== 'string') {
    throw new Error('Expected a JSON request body.');
  }

  return body;
};

const getRequestOptions = (
  fetchMock: jest.MockedFunction<typeof fetch>,
): RequestInit => {
  const calls = fetchMock.mock.calls as unknown[][];
  const options = calls[0]?.[1];

  if (typeof options !== 'object' || options === null) {
    throw new Error('Expected fetch request options.');
  }

  return options;
};

const getRequestUrl = (
  fetchMock: jest.MockedFunction<typeof fetch>,
): string => {
  const calls = fetchMock.mock.calls as unknown as unknown[][];
  const requestUrl = calls[0]?.[0];

  if (typeof requestUrl !== 'string') {
    throw new Error('Expected fetch request URL.');
  }

  return requestUrl;
};

describe('AiService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends the internal service key when calling the AI service', async () => {
    const fetchMock = jest.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ answer: '답변', sources: [] }));
    global.fetch = fetchMock;
    const configValues: Record<string, string> = {
      AI_SERVICE_URL: 'http://ai-service',
      AI_SERVICE_API_KEY: 'service-key',
    };
    const service = new AiService(
      {
        get: jest.fn((key: string): string | undefined => configValues[key]),
      } as unknown as ConfigService,
      { find: jest.fn() } as never,
    );

    await service.chat(
      { question: '온보딩 안내' },
      { role: 'employee', department: '엔지니어링' },
    );

    const requestOptions = getRequestOptions(fetchMock);
    expect(getRequestUrl(fetchMock)).toBe('http://ai-service/chat');
    expect(new Headers(requestOptions.headers).get('X-AI-Service-Key')).toBe(
      'service-key',
    );
    const requestPayload: unknown = JSON.parse(getRequestBody(fetchMock));
    expect(requestPayload).toEqual({
      question: '온보딩 안내',
      access: {
        role: 'employee',
        department: '엔지니어링',
      },
    });
  });

  it('uses an employee department instead of a client supplied onboarding department', async () => {
    const fetchMock = jest.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse({ answer: '답변', sources: [] }));
    global.fetch = fetchMock;
    const configValues: Record<string, string> = {
      AI_SERVICE_URL: 'http://ai-service',
      AI_SERVICE_API_KEY: 'service-key',
    };
    const service = new AiService(
      {
        get: jest.fn((key: string): string | undefined => configValues[key]),
      } as unknown as ConfigService,
      { find: jest.fn() } as never,
    );

    await service.onboarding(
      { department: '인사' },
      { role: 'employee', department: '엔지니어링' },
    );

    const requestPayload: unknown = JSON.parse(getRequestBody(fetchMock));
    expect(requestPayload).toMatchObject({
      department: '엔지니어링',
      access: {
        role: 'employee',
        department: '엔지니어링',
      },
    });
  });
});
