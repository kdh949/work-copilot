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
    const serviceSource = readFileSync(
      join(__dirname, 'work-briefs.service.ts'),
      'utf8',
    );

    expect(moduleSource).not.toMatch(
      /PostsModule|AiModule|AiSyncService|AiService/,
    );
    expect(clientSource).not.toMatch(/\/documents|pgvector|wiki_document/);
    expect(clientSource).toContain('/work-brief/generate');
    expect(serviceSource).toContain('collectIssueDraftContext');
    expect(serviceSource).toContain('collectDraftEvidence');
    expect(serviceSource).not.toMatch(
      /createIssue|createSubtask|remoteLink|transitionIssue|createPage|updatePage/,
    );
  });

  // The list and delete paths added new constructor dependencies. A missing
  // module import only fails at application boot, which no unit test reaches.
  it('imports a module for every service the draft list and delete depend on', () => {
    const moduleSource = readFileSync(
      join(__dirname, 'work-briefs.module.ts'),
      'utf8',
    );

    expect(moduleSource).toContain('PublicationModule');
    expect(moduleSource).toContain('OperationsModule');
    expect(moduleSource).toContain('TransientEvidenceFragmentsService');
  });

  it('reads publication state for the list without importing a write gateway', () => {
    const serviceSource = readFileSync(
      join(__dirname, 'work-briefs.service.ts'),
      'utf8',
    );

    expect(serviceSource).toContain('findLatestStoredSummaries');
    expect(serviceSource).not.toMatch(
      /PUBLICATION_WRITE_GATEWAY|findLatest\(|recoverPublicationFromSteps/,
    );
  });
});
