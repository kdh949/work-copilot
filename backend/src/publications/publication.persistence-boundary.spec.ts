import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('publication persistence boundary', () => {
  it('uses the explicitly mock-only write gateway and stores no brief content', () => {
    const moduleSource = readFileSync(
      join(__dirname, 'publication.module.ts'),
      'utf8',
    );
    const gatewaySource = readFileSync(
      join(__dirname, 'mock-publication-write.gateway.ts'),
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
    expect(gatewaySource).toContain("readonly mode = 'mock'");
    expect(gatewaySource).not.toMatch(/\bfetch\b|AtlassianOAuth|Authorization/);
    expect(serviceSource).not.toMatch(
      /PostsModule|AiModule|pgvector|wiki_document/,
    );
    expect(entitySource).not.toMatch(/maskedBrief|content|summary|commentBody/);
  });
});
