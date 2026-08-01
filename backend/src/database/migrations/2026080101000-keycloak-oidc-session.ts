import type { MigrationInterface, QueryRunner } from 'typeorm';

export class KeycloakOidcSession1785596400000 implements MigrationInterface {
  name = 'KeycloakOidcSession1785596400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "oidc_authorization_attempts" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "stateHash" character varying(128) NOT NULL UNIQUE,
                "nonceHash" character varying(128) NOT NULL,
                "pkceVerifierCiphertext" text NOT NULL,
                "pkceVerifierIv" character varying(64) NOT NULL,
                "pkceVerifierTag" character varying(64) NOT NULL,
                "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                "consumedAt" TIMESTAMP WITH TIME ZONE,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
            )
        `);
    await queryRunner.query(
      'CREATE INDEX "IDX_oidc_authorization_attempts_expiry" ON "oidc_authorization_attempts" ("expiresAt")',
    );
    await queryRunner.query(
      'ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "isWorkCopilotAdmin" boolean NOT NULL DEFAULT false',
    );
    await queryRunner.query(
      'ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "rotatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "oidc_authorization_attempts"');
    await queryRunner.query(
      'ALTER TABLE "auth_sessions" DROP COLUMN IF EXISTS "rotatedAt"',
    );
    await queryRunner.query(
      'ALTER TABLE "auth_sessions" DROP COLUMN IF EXISTS "isWorkCopilotAdmin"',
    );
  }
}
