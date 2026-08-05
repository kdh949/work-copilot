import { PublicationExecutionFencing1785873600000 } from './2026080500000-publication-execution-fencing';

describe('PublicationExecutionFencing migration', () => {
  it('adds only approval revision and execution fencing metadata', async () => {
    const statements: string[] = [];
    const query = jest.fn((statement: string): Promise<void> => {
      statements.push(statement);
      return Promise.resolve();
    });
    const migration = new PublicationExecutionFencing1785873600000();

    await migration.up({ query } as never);

    const sql = statements.join('\n');
    expect(sql).toContain('approvalRevision');
    expect(sql).toContain('executionToken');
    expect(sql).toContain('reviewRevision');
    expect(sql).toContain('approvedRevision');
    expect(sql).toContain('UPDATE "publication_steps"');
    expect(sql).not.toMatch(/rawContent|maskedBrief|accessToken|providerBody|secret/i);
  });

  it('drops every added column on down', async () => {
    const statements: string[] = [];
    const query = jest.fn((statement: string): Promise<void> => {
      statements.push(statement);
      return Promise.resolve();
    });

    await new PublicationExecutionFencing1785873600000().down({ query } as never);

    const sql = statements.join('\n');
    expect(sql).toContain('DROP COLUMN IF EXISTS "approvedRevision"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "reviewRevision"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "executionToken"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "approvalRevision"');
  });
});
