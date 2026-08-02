import { BadRequestException } from '@nestjs/common';
import { normalizeEvidence } from './evidence-normalizer';

describe('normalizeEvidence', () => {
  it('returns only normalized metadata and a bounded excerpt length', () => {
    const rawExcerpt = '<p>private provider body that must not be returned</p>';

    const evidence = normalizeEvidence({
      provider: 'confluence',
      sourceId: '200',
      url: 'https://confluence.example.test/pages/viewpage.action?pageId=200',
      title: 'Engineering decision',
      version: '7',
      excerptSource: rawExcerpt,
    });

    expect(evidence).toEqual({
      id: 'confluence:200',
      provider: 'confluence',
      sourceId: '200',
      url: 'https://confluence.example.test/pages/viewpage.action?pageId=200',
      title: 'Engineering decision',
      version: '7',
      excerptLength: 47,
      accessStatus: 'accessible',
      dlpStatus: 'not_evaluated',
    });
    expect(JSON.stringify(evidence)).not.toContain(rawExcerpt);
  });

  it('rejects evidence URLs with embedded credentials', () => {
    expect(() =>
      normalizeEvidence({
        provider: 'jira',
        sourceId: '100',
        url: 'https://token@jira.example.test/browse/ENG-1',
        title: 'Issue',
        version: '2026-08-02T00:00:00.000Z',
        excerptSource: '',
      }),
    ).toThrow(BadRequestException);
  });
});
