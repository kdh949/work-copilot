import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { WorkBriefContentGuard } from './work-brief-content-guard.service';

describe('WorkBriefContentGuard', () => {
  const guard = new WorkBriefContentGuard();

  it.each([
    'sk-proj-abcdefghijklmnopqrstuvwxyz',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.signature',
    '-----BEGIN PRIVATE KEY-----',
    'postgresql://db-user:db-password@db.example/internal',
    'OPENAI_API_KEY=synthetic-value',
    'api_key: synthetic-secret-value',
    'fixture/.env',
  ])(
    'rejects a secret fixture before it can reach an AI request: %s',
    (value) => {
      expect(() =>
        guard.assertSafeRequest('create a brief', [
          { evidenceId: 'jira:DEMO-1', content: value },
        ]),
      ).toThrow(BadRequestException);
    },
  );

  it('rejects secret-looking evidence identifiers too', () => {
    expect(() => guard.assertSafeFragment('fixture/.env', 'safe text')).toThrow(
      BadRequestException,
    );
  });

  it('uses a bounded evidence size before inspecting all content', () => {
    expect(() =>
      guard.assertSafeRequest('brief', [
        {
          evidenceId: 'jira:DEMO-1',
          content: 'a'.repeat(WorkBriefContentGuard.MAX_EVIDENCE_CHARS + 1),
        },
      ]),
    ).toThrow(PayloadTooLargeException);
  });

  it('rescans model output for secrets', () => {
    expect(() =>
      guard.assertSafeModelOutput([
        'summary',
        'mongodb://user:password@host/db',
      ]),
    ).toThrow(BadRequestException);
  });
});
