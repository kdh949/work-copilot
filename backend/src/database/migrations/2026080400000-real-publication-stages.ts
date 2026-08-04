import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RealPublicationStages1785782400000 implements MigrationInterface {
  name = 'RealPublicationStages1785782400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ADD COLUMN IF NOT EXISTS "jiraSummaryCommentId" character varying',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ADD COLUMN IF NOT EXISTS "confluencePageVersion" character varying',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ADD COLUMN IF NOT EXISTS "confluencePageUrl" text',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ADD COLUMN IF NOT EXISTS "confluenceContentHash" character varying(64)',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ADD COLUMN IF NOT EXISTS "requestedByUserId" integer REFERENCES "users"("id") ON DELETE RESTRICT',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ADD COLUMN IF NOT EXISTS "requestedAt" TIMESTAMP WITH TIME ZONE',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ADD COLUMN IF NOT EXISTS "jiraIdempotencyKeyHash" character varying(128)',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ADD COLUMN IF NOT EXISTS "childTasksIdempotencyKeyHash" character varying(128)',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ADD COLUMN IF NOT EXISTS "confluencePreviewHash" character varying(64)',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ADD COLUMN IF NOT EXISTS "jiraPreviewHash" character varying(64)',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ADD COLUMN IF NOT EXISTS "childTasksPreviewHash" character varying(64)',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ADD COLUMN IF NOT EXISTS "jiraApprovedByUserId" integer REFERENCES "users"("id") ON DELETE RESTRICT',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ADD COLUMN IF NOT EXISTS "jiraApprovedAt" TIMESTAMP WITH TIME ZONE',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ADD COLUMN IF NOT EXISTS "childTasksApprovedByUserId" integer REFERENCES "users"("id") ON DELETE RESTRICT',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ADD COLUMN IF NOT EXISTS "childTasksApprovedAt" TIMESTAMP WITH TIME ZONE',
    );
    await queryRunner.query(
      'ALTER TABLE "publication_steps" ADD COLUMN IF NOT EXISTS "phase" character varying(32) NOT NULL DEFAULT \'confluence\'',
    );
    await queryRunner.query(
      'ALTER TABLE "publication_steps" ADD COLUMN IF NOT EXISTS "idempotencyKeyHash" character varying(128)',
    );
    await queryRunner.query(
      `UPDATE "publication_steps"
       SET "phase" = CASE
         WHEN "stepKey" IN ('jira_remote_link', 'jira_summary_comment') THEN 'jira'
         WHEN "stepKey" LIKE 'jira_child_task:%' THEN 'child_tasks'
         ELSE 'confluence'
       END`,
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_brief_publications_jira_idempotency" ON "brief_publications" ("jiraIdempotencyKeyHash") WHERE "jiraIdempotencyKeyHash" IS NOT NULL',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_brief_publications_child_idempotency" ON "brief_publications" ("childTasksIdempotencyKeyHash") WHERE "childTasksIdempotencyKeyHash" IS NOT NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_brief_publications_child_idempotency"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_brief_publications_jira_idempotency"',
    );
    await queryRunner.query(
      'ALTER TABLE "publication_steps" DROP COLUMN IF EXISTS "idempotencyKeyHash"',
    );
    await queryRunner.query(
      'ALTER TABLE "publication_steps" DROP COLUMN IF EXISTS "phase"',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" DROP COLUMN IF EXISTS "childTasksApprovedAt"',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" DROP COLUMN IF EXISTS "childTasksApprovedByUserId"',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" DROP COLUMN IF EXISTS "jiraApprovedAt"',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" DROP COLUMN IF EXISTS "jiraApprovedByUserId"',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" DROP COLUMN IF EXISTS "childTasksPreviewHash"',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" DROP COLUMN IF EXISTS "jiraPreviewHash"',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" DROP COLUMN IF EXISTS "confluencePreviewHash"',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" DROP COLUMN IF EXISTS "childTasksIdempotencyKeyHash"',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" DROP COLUMN IF EXISTS "jiraIdempotencyKeyHash"',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" DROP COLUMN IF EXISTS "requestedAt"',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" DROP COLUMN IF EXISTS "requestedByUserId"',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" DROP COLUMN IF EXISTS "confluenceContentHash"',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" DROP COLUMN IF EXISTS "confluencePageUrl"',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" DROP COLUMN IF EXISTS "confluencePageVersion"',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" DROP COLUMN IF EXISTS "jiraSummaryCommentId"',
    );
  }
}
