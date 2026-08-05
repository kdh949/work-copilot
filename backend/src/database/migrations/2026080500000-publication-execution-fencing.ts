import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PublicationExecutionFencing1785873600000
  implements MigrationInterface
{
  name = 'PublicationExecutionFencing1785873600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ADD COLUMN IF NOT EXISTS "approvalRevision" integer NOT NULL DEFAULT 0',
    );
    await queryRunner.query(
      'ALTER TABLE "publication_steps" ADD COLUMN IF NOT EXISTS "executionToken" uuid',
    );
    await queryRunner.query(
      'ALTER TABLE "publication_steps" ADD COLUMN IF NOT EXISTS "reviewRevision" integer NOT NULL DEFAULT 0',
    );
    await queryRunner.query(
      'ALTER TABLE "publication_steps" ADD COLUMN IF NOT EXISTS "approvedRevision" integer',
    );
    // Existing durable steps were already approved by the time they reached
    // a terminal state.  Preserve that fact without storing request content.
    await queryRunner.query(
      `UPDATE "publication_steps"
       SET "reviewRevision" = 1,
           "approvedRevision" = 1
       WHERE "reviewRevision" = 0
         AND "status" IN ('SUCCEEDED', 'FAILED', 'NEEDS_REVIEW')`,
    );
    await queryRunner.query(
      `UPDATE "brief_publications" publication
       SET "approvalRevision" = COALESCE(
         (SELECT MAX("reviewRevision")
          FROM "publication_steps" step
          WHERE step."publicationId" = publication."id"),
         0
       )
       WHERE publication."approvalRevision" = 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "publication_steps" DROP COLUMN IF EXISTS "approvedRevision"',
    );
    await queryRunner.query(
      'ALTER TABLE "publication_steps" DROP COLUMN IF EXISTS "reviewRevision"',
    );
    await queryRunner.query(
      'ALTER TABLE "publication_steps" DROP COLUMN IF EXISTS "executionToken"',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" DROP COLUMN IF EXISTS "approvalRevision"',
    );
  }
}
