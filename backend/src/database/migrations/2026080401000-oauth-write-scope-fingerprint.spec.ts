import { OAuthWriteScopeFingerprint1785786000000 } from './2026080401000-oauth-write-scope-fingerprint';

describe('OAuthWriteScopeFingerprint migration', () => {
  it('records consented scopes for attempts and user OAuth connections', async () => {
    const statements: string[] = [];
    const query = jest.fn((statement: string): Promise<void> => {
      statements.push(statement);
      return Promise.resolve();
    });
    const migration = new OAuthWriteScopeFingerprint1785786000000();

    await migration.up({ query } as never);

    const sql = statements.join('\n');
    expect(sql).toContain('oauth_authorization_attempts');
    expect(sql).toContain('atlassian_oauth_connections');
    expect(sql).toContain('scopeFingerprint');
  });
});
