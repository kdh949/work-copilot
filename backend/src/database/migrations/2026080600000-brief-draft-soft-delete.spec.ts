import { BriefDraftSoftDelete1786000000000 } from './2026080600000-brief-draft-soft-delete';

const runStatements = async (
  run: (queryRunner: never) => Promise<void>,
): Promise<string[]> => {
  const statements: string[] = [];
  const query = jest.fn((statement: string): Promise<void> => {
    statements.push(statement);
    return Promise.resolve();
  });

  await run({ query } as never);

  return statements;
};

describe('BriefDraftSoftDelete migration', () => {
  it('adds the soft delete column and no brief content columns', async () => {
    const sql = (
      await runStatements((queryRunner) =>
        new BriefDraftSoftDelete1786000000000().up(queryRunner),
      )
    ).join('\n');

    expect(sql).toContain(
      'ALTER TABLE "work_brief_drafts" ADD COLUMN IF NOT EXISTS "deletedAt"',
    );
    expect(sql).not.toMatch(
      /maskedBrief|rawContent|excerpt|accessToken|secret/i,
    );
  });

  it('replaces the table constraint with a live-rows-only partial unique index', async () => {
    const statements = await runStatements((queryRunner) =>
      new BriefDraftSoftDelete1786000000000().up(queryRunner),
    );

    const dropIndex = statements.findIndex((statement) =>
      statement.includes(
        'DROP CONSTRAINT IF EXISTS "UQ_work_brief_drafts_profile_source"',
      ),
    );
    const createIndex = statements.findIndex((statement) =>
      statement.includes(
        'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_work_brief_drafts_profile_source"',
      ),
    );

    expect(dropIndex).toBeGreaterThanOrEqual(0);
    // R2: dropping without recreating would silently allow duplicate live
    // drafts for the same issue.  Both statements run in the same migration
    // transaction, in this order.
    expect(createIndex).toBeGreaterThan(dropIndex);
    expect(statements[createIndex]).toContain(
      'ON "work_brief_drafts" ("profileId", "sourceJiraId") WHERE "deletedAt" IS NULL',
    );
  });

  it('creates the list keyset index scoped to live drafts', async () => {
    const sql = (
      await runStatements((queryRunner) =>
        new BriefDraftSoftDelete1786000000000().up(queryRunner),
      )
    ).join('\n');

    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS "IDX_work_brief_drafts_owner_updated" ON "work_brief_drafts" ("createdByUserId", "updatedAt" DESC, "id" DESC) WHERE "deletedAt" IS NULL',
    );
  });

  it('purges soft-deleted rows before restoring the table constraint on down', async () => {
    const statements = await runStatements((queryRunner) =>
      new BriefDraftSoftDelete1786000000000().down(queryRunner),
    );

    const purge = statements.findIndex((statement) =>
      statement.includes(
        'DELETE FROM "work_brief_drafts" WHERE "deletedAt" IS NOT NULL',
      ),
    );
    const restore = statements.findIndex((statement) =>
      statement.includes(
        'ADD CONSTRAINT "UQ_work_brief_drafts_profile_source" UNIQUE',
      ),
    );
    const dropColumn = statements.findIndex((statement) =>
      statement.includes('DROP COLUMN IF EXISTS "deletedAt"'),
    );

    // R3: restoring the constraint fails while duplicate soft-deleted rows
    // remain, so the purge must come first.
    expect(purge).toBeGreaterThanOrEqual(0);
    expect(restore).toBeGreaterThan(purge);
    expect(dropColumn).toBeGreaterThan(restore);
  });

  it('removes safe publication history before its soft-deleted draft', async () => {
    const statements = await runStatements((queryRunner) =>
      new BriefDraftSoftDelete1786000000000().down(queryRunner),
    );
    const publications = statements.findIndex((statement) =>
      statement.includes('DELETE FROM "brief_publications" publication'),
    );
    const drafts = statements.findIndex((statement) =>
      statement.includes(
        'DELETE FROM "work_brief_drafts" WHERE "deletedAt" IS NOT NULL',
      ),
    );

    expect(publications).toBeGreaterThanOrEqual(0);
    expect(drafts).toBeGreaterThan(publications);
  });

  it('stops rollback before deleting a real, running, or indeterminate publication', async () => {
    const sql = (
      await runStatements((queryRunner) =>
        new BriefDraftSoftDelete1786000000000().down(queryRunner),
      )
    ).join('\n');

    const guard = sql.indexOf('BRIEF_DRAFT_SOFT_DELETE_ROLLBACK_BLOCKED');
    const publications = sql.indexOf('DELETE FROM "brief_publications" publication');

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(publications);
    expect(sql).toContain("publication.\"executionMode\" = 'real'");
    expect(sql).toContain("step.\"status\" = 'RUNNING'");
    expect(sql).toContain(
      "step.\"errorCode\" = 'PUBLICATION_RECONCILIATION_INDETERMINATE'",
    );
  });
});
