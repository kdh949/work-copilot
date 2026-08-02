import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('work brief persistence boundary', () => {
  it('does not import the wiki RAG or posts pipeline', () => {
    const moduleSource = readFileSync(
      join(__dirname, 'work-briefs.module.ts'),
      'utf8',
    );
    const clientSource = readFileSync(
      join(__dirname, 'work-brief-ai-client.service.ts'),
      'utf8',
    );

    expect(moduleSource).not.toMatch(
      /PostsModule|AiModule|AiSyncService|AiService/,
    );
    expect(clientSource).not.toMatch(/\/documents|pgvector|wiki_document/);
    expect(clientSource).toContain('/work-brief/generate');
  });
});
