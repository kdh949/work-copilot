import { WebhookPayloadParserService } from './webhook-payload-parser.service';

describe('WebhookPayloadParserService', () => {
  const parser = new WebhookPayloadParserService();

  it('extracts only Jira source ID, version, event time, and operation ID from a raw provider body', () => {
    const sensitiveTitle = '김민수 고객의 배포 요청';
    const sensitiveDescription =
      'postgresql://db-user:db-password@db.example/internal';
    const result = parser.parse('jira', {
      issue: {
        id: '10001',
        updated: '2026-08-02T10:00:00.000Z',
        fields: { summary: sensitiveTitle, description: sensitiveDescription },
      },
      comment: { body: 'fixture/.env must not be copied' },
      timestamp: '2026-08-02T10:00:00.000Z',
      operationId: 'operation-123',
    });

    expect(result).toEqual({
      sourceId: '10001',
      sourceVersion: '2026-08-02T10:00:00.000Z',
      eventTime: new Date('2026-08-02T10:00:00.000Z'),
      operationId: 'operation-123',
    });
    expect(JSON.stringify(result)).not.toContain(sensitiveTitle);
    expect(JSON.stringify(result)).not.toContain(sensitiveDescription);
    expect(JSON.stringify(result)).not.toContain('fixture/.env');
  });

  it('accepts a Confluence content version but rejects unwhitelisted source shapes', () => {
    expect(
      parser.parse('confluence', {
        content: { id: 1234, version: { number: 7 }, title: '비공개 제목' },
        timestamp: 1_786_000_000_000,
      }),
    ).toEqual(
      expect.objectContaining({ sourceId: '1234', sourceVersion: '7' }),
    );
    expect(
      parser.parse('jira', {
        sourceId: '10001',
        sourceVersion: '7',
      }),
    ).toBeNull();
    expect(
      parser.parse('jira', {
        issue: {
          id: 'sk-proj-abcdefghijklmnopqrstuv',
          updated: '2026-08-02T10:00:00.000Z',
        },
        timestamp: '2026-08-02T10:00:00.000Z',
      }),
    ).toBeNull();
  });
});
