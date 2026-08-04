import { PublicationStepRecovery1785789600000 } from './2026080402000-publication-step-recovery';

describe('PublicationStepRecovery migration', () => {
  it('keeps provider recovery data and removes lifetime phase-key uniqueness', async () => {
    const statements: string[] = [];
    const query = jest.fn((statement: string): Promise<void> => {
      statements.push(statement);
      return Promise.resolve();
    });

    await new PublicationStepRecovery1785789600000().up({ query } as never);

    const sql = statements.join('\n');
    expect(sql).toContain('providerObjectVersion');
    expect(sql).toContain('executionLeaseExpiresAt');
    expect(sql).toContain('DROP INDEX IF EXISTS "UQ_brief_publications_jira_idempotency"');
  });
});
