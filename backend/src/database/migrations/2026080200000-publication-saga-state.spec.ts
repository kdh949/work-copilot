import { QueryRunner } from 'typeorm';
import { PublicationSagaState1785609800000 } from './2026080200000-publication-saga-state';

describe('PublicationSagaState1785609800000', () => {
  it('adds only approval and mock execution metadata to publication records', async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(statement);
        return Promise.resolve();
      }),
    } as unknown as QueryRunner;

    await new PublicationSagaState1785609800000().up(queryRunner);

    const sql = statements.join('\n');
    expect(sql).toContain('"approvedByUserId"');
    expect(sql).toContain('"approvedAt"');
    expect(sql).toContain('"executionMode"');
    expect(sql).toContain("DEFAULT 'mock'");
    expect(sql).toContain('UQ_brief_publications_draft_version');
    expect(sql).not.toMatch(/rawContent|maskedBrief|accessToken|providerBody/);
  });
});
