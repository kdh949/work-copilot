import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('publication persistence boundary', () => {
  it('uses the real user-context adapter by default and stores no brief body', () => {
    const moduleSource = readFileSync(
      join(__dirname, 'publication.module.ts'),
      'utf8',
    );
    const gatewaySource = readFileSync(
      join(__dirname, 'mock-publication-write.gateway.ts'),
      'utf8',
    );
    const realGatewaySource = readFileSync(
      join(__dirname, 'atlassian-publication-write.gateway.ts'),
      'utf8',
    );
    const serviceSource = readFileSync(
      join(__dirname, 'publication.service.ts'),
      'utf8',
    );
    const entitySource = readFileSync(
      join(__dirname, 'entities', 'brief-publication.entity.ts'),
      'utf8',
    );

    expect(moduleSource).toContain('MockPublicationWriteGateway');
    expect(moduleSource).toContain('AtlassianPublicationWriteGateway');
    expect(moduleSource).toContain('PUBLICATION_WRITE_MODE');
    expect(moduleSource).toContain('? mockGateway');
    expect(gatewaySource).toContain("readonly mode = 'mock'");
    expect(gatewaySource).not.toMatch(/\bfetch\b|AtlassianOAuth|Authorization/);
    expect(realGatewaySource).toContain("readonly mode = 'real'");
    expect(realGatewaySource).toContain('IntegrationsOAuthService');
    expect(serviceSource).not.toMatch(
      /PostsModule|AiModule|pgvector|wiki_document/,
    );
    expect(entitySource).not.toMatch(
      /maskedBrief|bodyPreview|summaryText|commentBody|evidence/,
    );
  });
});
