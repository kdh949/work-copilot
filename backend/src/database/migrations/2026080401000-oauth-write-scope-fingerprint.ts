import type { MigrationInterface, QueryRunner } from 'typeorm';

export class OAuthWriteScopeFingerprint1785786000000 implements MigrationInterface {
  name = 'OAuthWriteScopeFingerprint1785786000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "oauth_authorization_attempts" ADD COLUMN IF NOT EXISTS "scopeFingerprint" character varying(64)',
    );
    await queryRunner.query(
      'ALTER TABLE "atlassian_oauth_connections" ADD COLUMN IF NOT EXISTS "scopeFingerprint" character varying(64)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "atlassian_oauth_connections" DROP COLUMN IF EXISTS "scopeFingerprint"',
    );
    await queryRunner.query(
      'ALTER TABLE "oauth_authorization_attempts" DROP COLUMN IF EXISTS "scopeFingerprint"',
    );
  }
}
