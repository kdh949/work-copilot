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
 * live row. It removes only safely-unpublished publication history before
 * hard-deleting soft-deleted drafts. Rows with a real provider result or an
 * indeterminate/running write block rollback explicitly rather than silently
 * deleting the only durable record of that external result. Back up before
 * rolling back.
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
    // An external write (or an unfinished/indeterminate one) is not safe to
    // discard during rollback. Stop before deleting any publication row so an
    // operator can restore or reconcile it deliberately.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
            FROM "work_brief_drafts" draft
            JOIN "brief_publications" publication
              ON publication."draftId" = draft."id"
            LEFT JOIN "publication_steps" step
              ON step."publicationId" = publication."id"
           WHERE draft."deletedAt" IS NOT NULL
             AND (
               publication."status" IN ('PENDING', 'PUBLISHING')
               OR step."status" = 'RUNNING'
               OR step."errorCode" = 'PUBLICATION_RECONCILIATION_INDETERMINATE'
               OR (
                 publication."executionMode" = 'real'
                 AND publication."confluenceContentId" IS NOT NULL
               )
               OR (
                 publication."executionMode" = 'real'
                 AND step."status" = 'SUCCEEDED'
                 AND step."providerObjectId" IS NOT NULL
               )
             )
        ) THEN
          RAISE EXCEPTION 'BRIEF_DRAFT_SOFT_DELETE_ROLLBACK_BLOCKED';
        END IF;
      END $$;
    `);
    // `brief_publications.draftId` is ON DELETE RESTRICT. Safe publication
    // rows (and their cascading steps) must go first or the draft DELETE
    // below fails before the unique constraint can be restored.
    await queryRunner.query(`
      DELETE FROM "brief_publications" publication
      USING "work_brief_drafts" draft
      WHERE publication."draftId" = draft."id"
        AND draft."deletedAt" IS NOT NULL
    `);
    // Irreversible data loss: remaining soft-deleted drafts are removed so
    // the table constraint below can be restored without duplicate-key errors.
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
