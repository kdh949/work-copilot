import { ConfigService } from '@nestjs/config';
import { type PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions';
import { WorkCopilotFoundation1785510000000 } from '../database/migrations/2026080100000-work-copilot-foundation';

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

  return {
    type: 'postgres',
    host: environment.DB_HOST,
    port: databasePort(environment.DB_PORT),
    username: environment.DB_USERNAME,
    password: environment.DB_PASSWORD,
    database: environment.DB_DATABASE,
    ssl: useSsl
      ? {
          rejectUnauthorized:
            environment.DB_SSL_REJECT_UNAUTHORIZED?.toLowerCase() !== 'false',
        }
      : false,
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: 'schema_migrations',
    migrations: [WorkCopilotFoundation1785510000000],
  };
};

export const createDatabaseOptionsFromConfig = (
  configService: ConfigService,
): PostgresDataSourceOptions =>
  createDatabaseOptions({
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
