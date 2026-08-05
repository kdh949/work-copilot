import { ConfigService } from '@nestjs/config';
import { type PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions';
import { WorkCopilotFoundation1785510000000 } from '../database/migrations/2026080100000-work-copilot-foundation';
import { KeycloakOidcSession1785596400000 } from '../database/migrations/2026080101000-keycloak-oidc-session';
import { PublicationSagaState1785609800000 } from '../database/migrations/2026080200000-publication-saga-state';
import { WebhookFreshnessState1785613400000 } from '../database/migrations/2026080201000-webhook-freshness-state';
import { RealPublicationStages1785782400000 } from '../database/migrations/2026080400000-real-publication-stages';
import { OAuthWriteScopeFingerprint1785786000000 } from '../database/migrations/2026080401000-oauth-write-scope-fingerprint';
import { PublicationStepRecovery1785789600000 } from '../database/migrations/2026080402000-publication-step-recovery';
import { PublicationExecutionFencing1785873600000 } from '../database/migrations/2026080500000-publication-execution-fencing';

type Environment = NodeJS.ProcessEnv;

const isEnabled = (value: string | undefined): boolean =>
  value?.toLowerCase() === 'true';

const databasePort = (value: string | undefined): number => {
  const port = Number(value ?? 5432);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT must be a valid TCP port.');
  }

  return port;
};

export const createDatabaseOptions = (
  environment: Environment = process.env,
): PostgresDataSourceOptions => {
  const useSsl = isEnabled(environment.DB_SSL);
  const databaseUrl = environment.DATABASE_URL?.trim();

  return {
    type: 'postgres',
    ...(databaseUrl
      ? { url: databaseUrl }
      : {
          host: environment.DB_HOST,
          port: databasePort(environment.DB_PORT),
          username: environment.DB_USERNAME,
          password: environment.DB_PASSWORD,
          database: environment.DB_DATABASE,
        }),
    ssl: useSsl
      ? {
          rejectUnauthorized:
            environment.DB_SSL_REJECT_UNAUTHORIZED?.toLowerCase() !== 'false',
        }
      : false,
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: 'schema_migrations',
    migrations: [
      WorkCopilotFoundation1785510000000,
      KeycloakOidcSession1785596400000,
      PublicationSagaState1785609800000,
      WebhookFreshnessState1785613400000,
      RealPublicationStages1785782400000,
      OAuthWriteScopeFingerprint1785786000000,
      PublicationStepRecovery1785789600000,
      PublicationExecutionFencing1785873600000,
    ],
  };
};

export const createDatabaseOptionsFromConfig = (
  configService: ConfigService,
): PostgresDataSourceOptions =>
  createDatabaseOptions({
    DATABASE_URL: configService.get<string>('DATABASE_URL'),
    DB_HOST: configService.get<string>('DB_HOST'),
    DB_PORT: configService.get<string>('DB_PORT'),
    DB_USERNAME: configService.get<string>('DB_USERNAME'),
    DB_PASSWORD: configService.get<string>('DB_PASSWORD'),
    DB_DATABASE: configService.get<string>('DB_DATABASE'),
    DB_SSL: configService.get<string>('DB_SSL'),
    DB_SSL_REJECT_UNAUTHORIZED: configService.get<string>(
      'DB_SSL_REJECT_UNAUTHORIZED',
    ),
  });
