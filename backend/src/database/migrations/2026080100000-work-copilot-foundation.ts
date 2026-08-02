import { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkCopilotFoundation1785510000000 implements MigrationInterface {
  name = 'WorkCopilotFoundation1785510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "users" (
                "id" SERIAL NOT NULL,
                "email" character varying NOT NULL,
                "password" character varying NOT NULL,
                "nickname" character varying NOT NULL,
                "department" character varying,
                "employeeNumber" character varying,
                "role" character varying NOT NULL DEFAULT 'employee',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_users_id" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_users_email" UNIQUE ("email"),
                CONSTRAINT "UQ_users_employee_number" UNIQUE ("employeeNumber")
            )
        `);
    await queryRunner.query(
      'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "keycloakSubject" character varying',
    );
    await queryRunner.query(
      'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "identityProvider" character varying',
    );
    await queryRunner.query(
      'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "legacyMigratedAt" TIMESTAMP WITH TIME ZONE',
    );
    await queryRunner.query(
      'ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_keycloak_subject" ON "users" ("keycloakSubject") WHERE "keycloakSubject" IS NOT NULL',
    );

    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "post" (
                "id" SERIAL NOT NULL,
                "sourceId" character varying,
                "wikiPath" jsonb,
                "parentSourceId" character varying,
                "depth" integer NOT NULL DEFAULT 0,
                "docType" character varying,
                "summary" text,
                "title" character varying NOT NULL,
                "content" text NOT NULL,
                "boardType" character varying NOT NULL DEFAULT 'wiki',
                "department" character varying NOT NULL DEFAULT '공통',
                "tags" text,
                "authorId" integer NOT NULL,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_post_id" PRIMARY KEY ("id"),
                CONSTRAINT "FK_post_author" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
            )
        `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_post_source_id_unique" ON "post" ("sourceId") WHERE "sourceId" IS NOT NULL',
    );

    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "comment" (
                "id" SERIAL NOT NULL,
                "content" text NOT NULL,
                "isAi" boolean NOT NULL DEFAULT false,
                "postId" integer NOT NULL,
                "authorId" integer,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_comment_id" PRIMARY KEY ("id"),
                CONSTRAINT "FK_comment_post" FOREIGN KEY ("postId") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
                CONSTRAINT "FK_comment_author" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
            )
        `);

    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "ai_sync_outbox" (
                "id" SERIAL NOT NULL,
                "sourceId" character varying(100) NOT NULL,
                "operation" character varying(16) NOT NULL,
                "status" character varying(16) NOT NULL DEFAULT 'pending',
                "attempts" integer NOT NULL DEFAULT 0,
                "nextAttemptAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "lastError" text,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_ai_sync_outbox_id" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_ai_sync_outbox_pending" ON "ai_sync_outbox" ("status", "nextAttemptAt")',
    );

    await queryRunner.query(`
            CREATE TABLE "integration_profiles" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "jiraBaseUrl" text NOT NULL,
                "confluenceBaseUrl" text NOT NULL,
                "jiraClientId" text NOT NULL,
                "confluenceClientId" text NOT NULL,
                "jiraClientSecretCiphertext" text,
                "jiraClientSecretIv" character varying(64),
                "jiraClientSecretTag" character varying(64),
                "confluenceClientSecretCiphertext" text,
                "confluenceClientSecretIv" character varying(64),
                "confluenceClientSecretTag" character varying(64),
                "webhookRouteSecretCiphertext" text,
                "webhookRouteSecretIv" character varying(64),
                "webhookRouteSecretTag" character varying(64),
                "encryptionKeyVersion" integer NOT NULL DEFAULT 1,
                "allowedProjectKeys" jsonb NOT NULL DEFAULT '[]'::jsonb,
                "allowedSpaceKeys" jsonb NOT NULL DEFAULT '[]'::jsonb,
                "briefParentPageId" character varying,
                "policy" jsonb NOT NULL DEFAULT '{}'::jsonb,
                "isActive" boolean NOT NULL DEFAULT false,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
            )
        `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_integration_profiles_one_active" ON "integration_profiles" ("isActive") WHERE "isActive"',
    );

    await queryRunner.query(`
            CREATE TABLE "auth_sessions" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "sessionTokenHash" character varying(128) NOT NULL UNIQUE,
                "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
                "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                "revokedAt" TIMESTAMP WITH TIME ZONE,
                "csrfSecretHash" character varying(128) NOT NULL,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
            )
        `);
    await queryRunner.query(
      'CREATE INDEX "IDX_auth_sessions_active" ON "auth_sessions" ("userId", "expiresAt") WHERE "revokedAt" IS NULL',
    );

    await queryRunner.query(`
            CREATE TABLE "oauth_authorization_attempts" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "provider" character varying(32) NOT NULL,
                "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
                "profileId" uuid NOT NULL REFERENCES "integration_profiles"("id") ON DELETE CASCADE,
                "stateHash" character varying(128) NOT NULL UNIQUE,
                "pkceVerifierCiphertext" text NOT NULL,
                "pkceVerifierIv" character varying(64) NOT NULL,
                "pkceVerifierTag" character varying(64) NOT NULL,
                "encryptionKeyVersion" integer NOT NULL DEFAULT 1,
                "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                "consumedAt" TIMESTAMP WITH TIME ZONE,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "CHK_oauth_authorization_attempts_provider" CHECK ("provider" IN ('jira', 'confluence'))
            )
        `);
    await queryRunner.query(
      'CREATE INDEX "IDX_oauth_authorization_attempts_expiry" ON "oauth_authorization_attempts" ("expiresAt")',
    );

    await queryRunner.query(`
            CREATE TABLE "atlassian_oauth_connections" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
                "profileId" uuid NOT NULL REFERENCES "integration_profiles"("id") ON DELETE CASCADE,
                "provider" character varying(32) NOT NULL,
                "tokensCiphertext" text NOT NULL,
                "tokensIv" character varying(64) NOT NULL,
                "tokensTag" character varying(64) NOT NULL,
                "encryptionKeyVersion" integer NOT NULL DEFAULT 1,
                "tokenExpiresAt" TIMESTAMP WITH TIME ZONE,
                "tokenVersion" integer NOT NULL DEFAULT 1,
                "status" character varying(32) NOT NULL DEFAULT 'connected',
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_atlassian_oauth_connections_user_profile_provider" UNIQUE ("userId", "profileId", "provider"),
                CONSTRAINT "CHK_atlassian_oauth_connections_provider" CHECK ("provider" IN ('jira', 'confluence'))
            )
        `);

    await queryRunner.query(`
            CREATE TABLE "work_brief_drafts" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "profileId" uuid NOT NULL REFERENCES "integration_profiles"("id") ON DELETE RESTRICT,
                "createdByUserId" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
                "sourceJiraId" character varying NOT NULL,
                "sourceJiraKey" character varying NOT NULL,
                "sourceJiraVersion" character varying NOT NULL,
                "maskedBrief" jsonb NOT NULL DEFAULT '{}'::jsonb,
                "evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
                "status" character varying(32) NOT NULL DEFAULT 'draft',
                "optimisticVersion" integer NOT NULL DEFAULT 1,
                "freshnessStatus" character varying(32) NOT NULL DEFAULT 'current',
                "policyVersion" integer NOT NULL DEFAULT 1,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_work_brief_drafts_profile_source" UNIQUE ("profileId", "sourceJiraId")
            )
        `);
    await queryRunner.query(
      'CREATE INDEX "IDX_work_brief_drafts_user_status" ON "work_brief_drafts" ("createdByUserId", "status")',
    );

    await queryRunner.query(`
            CREATE TABLE "transient_evidence_fragments" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "draftId" uuid NOT NULL REFERENCES "work_brief_drafts"("id") ON DELETE CASCADE,
                "evidenceId" character varying NOT NULL,
                "ciphertext" text NOT NULL,
                "iv" character varying(64) NOT NULL,
                "authenticationTag" character varying(64) NOT NULL,
                "encryptionKeyVersion" integer NOT NULL DEFAULT 1,
                "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_transient_evidence_fragments_draft_evidence" UNIQUE ("draftId", "evidenceId")
            )
        `);
    await queryRunner.query(
      'CREATE INDEX "IDX_transient_evidence_fragments_expiry" ON "transient_evidence_fragments" ("expiresAt")',
    );

    await queryRunner.query(`
            CREATE TABLE "source_change_events" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "provider" character varying(32) NOT NULL,
                "profileId" uuid NOT NULL REFERENCES "integration_profiles"("id") ON DELETE CASCADE,
                "sourceId" character varying NOT NULL,
                "sourceVersion" character varying,
                "eventTime" TIMESTAMP WITH TIME ZONE NOT NULL,
                "eventFingerprint" character varying(128) NOT NULL,
                "ingressAuthResult" character varying(32) NOT NULL,
                "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_source_change_events_fingerprint" UNIQUE ("profileId", "eventFingerprint"),
                CONSTRAINT "CHK_source_change_events_provider" CHECK ("provider" IN ('jira', 'confluence'))
            )
        `);
    await queryRunner.query(
      'CREATE INDEX "IDX_source_change_events_expiry" ON "source_change_events" ("expiresAt")',
    );

    await queryRunner.query(`
            CREATE TABLE "readiness_assessments" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "draftId" uuid NOT NULL REFERENCES "work_brief_drafts"("id") ON DELETE CASCADE,
                "sourceJiraId" character varying NOT NULL,
                "assessmentVersion" integer NOT NULL,
                "status" character varying(32) NOT NULL,
                "findings" jsonb NOT NULL DEFAULT '[]'::jsonb,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_readiness_assessments_draft_version" UNIQUE ("draftId", "assessmentVersion")
            )
        `);

    await queryRunner.query(`
            CREATE TABLE "brief_publications" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "draftId" uuid NOT NULL REFERENCES "work_brief_drafts"("id") ON DELETE RESTRICT,
                "operationId" uuid NOT NULL UNIQUE,
                "idempotencyKeyHash" character varying(128) NOT NULL UNIQUE,
                "draftVersion" integer NOT NULL,
                "status" character varying(32) NOT NULL DEFAULT 'pending',
                "confluenceContentId" character varying,
                "jiraRemoteLinkId" character varying,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
            )
        `);

    await queryRunner.query(`
            CREATE TABLE "publication_steps" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "publicationId" uuid NOT NULL REFERENCES "brief_publications"("id") ON DELETE CASCADE,
                "stepKey" character varying(64) NOT NULL,
                "status" character varying(32) NOT NULL DEFAULT 'pending',
                "attempts" integer NOT NULL DEFAULT 0,
                "errorCode" character varying(64),
                "providerObjectId" character varying,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_publication_steps_publication_step" UNIQUE ("publicationId", "stepKey")
            )
        `);

    await queryRunner.query(`
            CREATE TABLE "security_audit_events" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "actorUserId" integer REFERENCES "users"("id") ON DELETE SET NULL,
                "action" character varying(64) NOT NULL,
                "profileId" uuid REFERENCES "integration_profiles"("id") ON DELETE SET NULL,
                "targetId" character varying,
                "resultCode" character varying(64) NOT NULL,
                "correlationId" character varying(64) NOT NULL,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
            )
        `);
    await queryRunner.query(
      'CREATE INDEX "IDX_security_audit_events_actor_created" ON "security_audit_events" ("actorUserId", "createdAt")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // A Keycloak-only account has no legacy password that a rollback can
    // reconstruct. Fail before dropping any copilot tables instead of exposing
    // operators to a late PostgreSQL NOT NULL error or silently fabricating a
    // credential.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "users" WHERE "password" IS NULL) THEN
          RAISE EXCEPTION 'WORK_COPILOT_LEGACY_PASSWORD_ROLLBACK_BLOCKED';
        END IF;
      END $$;
    `);
    await queryRunner.query('DROP TABLE "security_audit_events"');
    await queryRunner.query('DROP TABLE "publication_steps"');
    await queryRunner.query('DROP TABLE "brief_publications"');
    await queryRunner.query('DROP TABLE "readiness_assessments"');
    await queryRunner.query('DROP TABLE "source_change_events"');
    await queryRunner.query('DROP TABLE "transient_evidence_fragments"');
    await queryRunner.query('DROP TABLE "work_brief_drafts"');
    await queryRunner.query('DROP TABLE "atlassian_oauth_connections"');
    await queryRunner.query('DROP TABLE "oauth_authorization_attempts"');
    await queryRunner.query('DROP TABLE "auth_sessions"');
    await queryRunner.query('DROP TABLE "integration_profiles"');
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_users_keycloak_subject"',
    );
    await queryRunner.query(
      'ALTER TABLE "users" DROP COLUMN IF EXISTS "legacyMigratedAt"',
    );
    await queryRunner.query(
      'ALTER TABLE "users" DROP COLUMN IF EXISTS "identityProvider"',
    );
    await queryRunner.query(
      'ALTER TABLE "users" DROP COLUMN IF EXISTS "keycloakSubject"',
    );
    await queryRunner.query(
      'ALTER TABLE "users" ALTER COLUMN "password" SET NOT NULL',
    );
  }
}
