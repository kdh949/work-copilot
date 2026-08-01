import type { QueryRunner } from 'typeorm';
import { KeycloakOidcSession1785596400000 } from './2026080101000-keycloak-oidc-session';

describe('KeycloakOidcSession1785596400000', () => {
  it('adds single-use OIDC state storage and session claim metadata', async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(statement);
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new KeycloakOidcSession1785596400000().up(queryRunner);

    expect(statements.join('\n')).toContain(
      'CREATE TABLE "oidc_authorization_attempts"',
    );
    expect(statements.join('\n')).toContain(
      '"isWorkCopilotAdmin" boolean NOT NULL DEFAULT false',
    );
    expect(statements.join('\n')).toContain(
      '"rotatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()',
    );
  });
});
