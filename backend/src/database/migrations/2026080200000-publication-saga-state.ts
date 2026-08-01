import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PublicationSagaState1785609800000 implements MigrationInterface {
  name = 'PublicationSagaState1785609800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ADD COLUMN IF NOT EXISTS "approvedByUserId" integer REFERENCES "users"("id") ON DELETE RESTRICT',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP WITH TIME ZONE',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ADD COLUMN IF NOT EXISTS "executionMode" character varying(16) NOT NULL DEFAULT \'mock\'',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ALTER COLUMN "status" SET DEFAULT \'PENDING\'',
    );
    await queryRunner.query(
      'ALTER TABLE "publication_steps" ALTER COLUMN "status" SET DEFAULT \'PENDING\'',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_brief_publications_draft_version" ON "brief_publications" ("draftId", "draftVersion")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_brief_publications_draft_version"',
    );
    await queryRunner.query(
      'ALTER TABLE "publication_steps" ALTER COLUMN "status" SET DEFAULT \'pending\'',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ALTER COLUMN "status" SET DEFAULT \'pending\'',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" DROP COLUMN IF EXISTS "executionMode"',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" DROP COLUMN IF EXISTS "approvedAt"',
    );
    await queryRunner.query(
      'ALTER TABLE "brief_publications" DROP COLUMN IF EXISTS "approvedByUserId"',
    );
  }
}
