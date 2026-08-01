import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('readiness read-only boundary', () => {
  it('uses Jira read requests and persists only assessment metadata', () => {
    const readinessSource = readFileSync(
      join(__dirname, 'readiness.service.ts'),
      'utf8',
    );
    const jiraSource = readFileSync(
      join(__dirname, '..', 'work-items', 'jira', 'jira-work-item.service.ts'),
      'utf8',
    );

    expect(readinessSource).toContain('assertDraftPublishAllowed');
    expect(readinessSource).not.toMatch(
      /fetch\(|createIssue|createSubtask|remoteLink|transitionIssue/,
    );
    expect(jiraSource).toContain('readClient.getJson');
    expect(jiraSource).not.toMatch(
      /readClient\.(?:post|put|patch|delete)|method:\s*['"](?:POST|PUT|PATCH|DELETE)/,
    );
  });
});
