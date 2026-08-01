import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WebhookFreshnessState1785613400000 implements MigrationInterface {
  name = 'WebhookFreshnessState1785613400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "brief_publications" ADD COLUMN IF NOT EXISTS "reviewRequiredAt" TIMESTAMP WITH TIME ZONE',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "brief_publications" DROP COLUMN IF EXISTS "reviewRequiredAt"',
    );
  }
}
