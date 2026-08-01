import { createDatabaseOptions } from './database.config';
import { WorkCopilotFoundation1785510000000 } from '../database/migrations/2026080100000-work-copilot-foundation';

describe('createDatabaseOptions', () => {
  it('disables automatic schema synchronization and registers the migration', () => {
    const options = createDatabaseOptions({
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USERNAME: 'postgres',
      DB_PASSWORD: 'postgres',
      DB_DATABASE: 'dh_board',
      DB_SSL: 'false',
    });

    expect(options.synchronize).toBe(false);
    expect(options.migrationsRun).toBe(false);
    expect(options.migrationsTableName).toBe('schema_migrations');
    expect(options.migrations).toContain(WorkCopilotFoundation1785510000000);
  });

  it('rejects invalid database ports before a connection is attempted', () => {
    expect(() =>
      createDatabaseOptions({
        DB_PORT: 'not-a-port',
      }),
    ).toThrow('DB_PORT must be a valid TCP port.');
  });
});
