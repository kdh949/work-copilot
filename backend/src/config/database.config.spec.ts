import { createDatabaseOptions } from './database.config';
import { WorkCopilotFoundation1785510000000 } from '../database/migrations/2026080100000-work-copilot-foundation';
import { PublicationSagaState1785609800000 } from '../database/migrations/2026080200000-publication-saga-state';
import { PublicationExecutionFencing1785873600000 } from '../database/migrations/2026080500000-publication-execution-fencing';

describe('createDatabaseOptions', () => {
  it('disables automatic schema synchronization and registers the migration', () => {
    const options = createDatabaseOptions({
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USERNAME: 'postgres',
      DB_PASSWORD: 'postgres',
      DB_DATABASE: 'work_copilot',
      DB_SSL: 'false',
    });

    expect(options.synchronize).toBe(false);
    expect(options.migrationsRun).toBe(false);
    expect(options.migrationsTableName).toBe('schema_migrations');
    expect(options.migrations).toContain(WorkCopilotFoundation1785510000000);
    expect(options.migrations).toContain(PublicationSagaState1785609800000);
    expect(options.migrations).toContain(PublicationExecutionFencing1785873600000);
  });

  it('rejects invalid database ports before a connection is attempted', () => {
    expect(() =>
      createDatabaseOptions({
        DB_PORT: 'not-a-port',
      }),
    ).toThrow('DB_PORT must be a valid TCP port.');
  });

  it('prefers a managed database URL when one is provided', () => {
    const options = createDatabaseOptions({
      DATABASE_URL: 'postgresql://service:secret@database.internal:5432/app',
      DB_PORT: 'not-a-port',
      DB_SSL: 'true',
    });

    expect(options.url).toBe(
      'postgresql://service:secret@database.internal:5432/app',
    );
    expect(options.host).toBeUndefined();
  });
});
