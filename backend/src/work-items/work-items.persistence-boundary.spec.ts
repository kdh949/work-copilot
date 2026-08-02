import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workItemsFiles = [
  'atlassian-read-client.service.ts',
  'integration-access-policy.service.ts',
  'work-items.module.ts',
  'jira/jira-work-item.service.ts',
  'confluence/confluence-work-item.service.ts',
  'evidence/evidence-normalizer.ts',
];

describe('work-item persistence boundary', () => {
  it('does not import the Post/RAG write paths or mention their persistence tables', () => {
    const root = join(__dirname);
    const source = workItemsFiles
      .map((file) => readFileSync(join(root, file), 'utf8'))
      .join('\n');

    expect(source).not.toMatch(
      /PostsModule|PostsService|AiSyncService|AiService/,
    );
    expect(source).not.toMatch(/wiki_documents|wiki_document_chunks/);
    expect(source).not.toMatch(
      /@InjectRepository\(Post\)|@InjectRepository\(AiSyncOutbox\)/,
    );
  });
});
