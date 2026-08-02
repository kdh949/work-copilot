import { QueryRunner } from 'typeorm';
import { WorkCopilotFoundation1785510000000 } from './2026080100000-work-copilot-foundation';

describe('WorkCopilotFoundation1785510000000', () => {
  it('creates only encrypted transient content and the planned safety tables', async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(statement);
        return Promise.resolve();
      }),
    } as unknown as QueryRunner;

    await new WorkCopilotFoundation1785510000000().up(queryRunner);

    const sql = statements.join('\n');
    expect(sql).toContain('CREATE TABLE "auth_sessions"');
    expect(sql).toContain('CREATE TABLE "integration_profiles"');
    expect(sql).toContain('CREATE TABLE "atlassian_oauth_connections"');
    expect(sql).toContain('CREATE TABLE "work_brief_drafts"');
    expect(sql).toContain('CREATE TABLE "brief_publications"');
    expect(sql).toContain('CREATE TABLE "security_audit_events"');
    expect(sql).toContain('"ciphertext" text NOT NULL');
    expect(sql).not.toContain('"rawContent"');
  });

  it('keeps the pre-existing core tables when rolling back the foundation', async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(statement);
        return Promise.resolve();
      }),
    } as unknown as QueryRunner;

    await new WorkCopilotFoundation1785510000000().down(queryRunner);

    expect(statements).toContain('DROP TABLE "security_audit_events"');
    expect(statements).not.toContain('DROP TABLE "users"');
    expect(statements).not.toContain('DROP TABLE "post"');
  });

  it('checks for Keycloak-only users before attempting a rollback', async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(statement);
        return Promise.resolve();
      }),
    } as unknown as QueryRunner;

    await new WorkCopilotFoundation1785510000000().down(queryRunner);

    expect(statements.at(0)).toContain(
      'WORK_COPILOT_LEGACY_PASSWORD_ROLLBACK_BLOCKED',
    );
  });
});
