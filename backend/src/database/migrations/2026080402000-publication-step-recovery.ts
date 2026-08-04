import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PublicationStepRecovery1785789600000 implements MigrationInterface {
  name = 'PublicationStepRecovery1785789600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "publication_steps" ADD COLUMN IF NOT EXISTS "providerObjectVersion" character varying',
    );
    await queryRunner.query(
      'ALTER TABLE "publication_steps" ADD COLUMN IF NOT EXISTS "providerUrl" text',
    );
    await queryRunner.query(
      'ALTER TABLE "publication_steps" ADD COLUMN IF NOT EXISTS "contentHash" character varying(64)',
    );
    await queryRunner.query(
      'ALTER TABLE "publication_steps" ADD COLUMN IF NOT EXISTS "executionLeaseExpiresAt" TIMESTAMP WITH TIME ZONE',
    );
    // Phase keys now identify one command delivery, not a publication's
    // lifetime. Retrying after a browser restart must be allowed.
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_brief_publications_jira_idempotency"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_brief_publications_child_idempotency"',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_brief_publications_jira_idempotency" ON "brief_publications" ("jiraIdempotencyKeyHash") WHERE "jiraIdempotencyKeyHash" IS NOT NULL',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_brief_publications_child_idempotency" ON "brief_publications" ("childTasksIdempotencyKeyHash") WHERE "childTasksIdempotencyKeyHash" IS NOT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE "publication_steps" DROP COLUMN IF EXISTS "executionLeaseExpiresAt"',
    );
    await queryRunner.query(
      'ALTER TABLE "publication_steps" DROP COLUMN IF EXISTS "contentHash"',
    );
    await queryRunner.query(
      'ALTER TABLE "publication_steps" DROP COLUMN IF EXISTS "providerUrl"',
    );
    await queryRunner.query(
      'ALTER TABLE "publication_steps" DROP COLUMN IF EXISTS "providerObjectVersion"',
    );
  }
}
