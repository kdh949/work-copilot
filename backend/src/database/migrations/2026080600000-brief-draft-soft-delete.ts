import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Soft delete for brief drafts.
 *
 * The "one live draft per issue" rule must survive deletion, so the table-level
 * UNIQUE constraint is replaced by a partial unique index restricted to rows
 * where "deletedAt" IS NULL.  DROP and CREATE run inside the migration
 * transaction so the table is never left without duplicate protection.
 *
 * WARNING — down() is destructive.  Restoring the table constraint is
 * impossible while soft-deleted rows share a (profileId, sourceJiraId) with a
 * live row, so down() hard-deletes every row with "deletedAt" IS NOT NULL
 * first.  That data cannot be recovered.  Back up before rolling back.
 */
export class BriefDraftSoftDelete1786000000000 implements MigrationInterface {
  name = 'BriefDraftSoftDelete1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "work_brief_drafts" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP WITH TIME ZONE',
    );
    // The per-issue uniqueness rule applies to live drafts only.
    await queryRunner.query(
      'ALTER TABLE "work_brief_drafts" DROP CONSTRAINT IF EXISTS "UQ_work_brief_drafts_profile_source"',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_work_brief_drafts_profile_source" ON "work_brief_drafts" ("profileId", "sourceJiraId") WHERE "deletedAt" IS NULL',
    );
    // Keyset ordering index for GET /brief-drafts.
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_work_brief_drafts_owner_updated" ON "work_brief_drafts" ("createdByUserId", "updatedAt" DESC, "id" DESC) WHERE "deletedAt" IS NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_work_brief_drafts_owner_updated"',
    );
    // Irreversible data loss: soft-deleted drafts are removed so the table
    // constraint below can be restored without duplicate-key failures.
    await queryRunner.query(
      'DELETE FROM "work_brief_drafts" WHERE "deletedAt" IS NOT NULL',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_work_brief_drafts_profile_source"',
    );
    await queryRunner.query(
      'ALTER TABLE "work_brief_drafts" ADD CONSTRAINT "UQ_work_brief_drafts_profile_source" UNIQUE ("profileId", "sourceJiraId")',
    );
    await queryRunner.query(
      'ALTER TABLE "work_brief_drafts" DROP COLUMN IF EXISTS "deletedAt"',
    );
  }
}
