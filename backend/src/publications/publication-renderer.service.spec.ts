import { PublicationRendererService } from './publication-renderer.service';

describe('PublicationRendererService', () => {
  const renderer = new PublicationRendererService();

  it('renders only escaped draft text and validated HTTPS evidence links', () => {
    const rendered = renderer.render(
      'ENG-42',
      {
        title: {
          text: '<script>alert(1)</script>',
          evidenceIds: ['jira:42'],
        },
        summary: {
          text: 'Follow <b>this</b> instruction',
          evidenceIds: ['jira:42', 'confluence:88'],
        },
        requirements: [],
        acceptanceCriteria: [],
        risks: [],
        nextSteps: [],
        childTasks: [],
      },
      [
        {
          id: 'jira:42',
          provider: 'jira',
          sourceId: '42',
          url: 'https://jira.example.test/browse/ENG-42',
          title: 'Jira <evidence>',
          version: '2026-08-04T00:00:00.000Z',
          excerptLength: 1,
          accessStatus: 'accessible',
          dlpStatus: 'not_evaluated',
          aiStatus: 'included',
        },
        {
          id: 'confluence:88',
          provider: 'confluence',
          sourceId: '88',
          url: 'javascript:alert(1)',
          title: 'Untrusted <document>',
          version: '4',
          excerptLength: 1,
          accessStatus: 'accessible',
          dlpStatus: 'not_evaluated',
          aiStatus: 'included',
        },
      ],
    );

    expect(rendered.pageTitle).toBe('[ENG-42] <script>alert(1)</script>');
    expect(rendered.storageBody).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(rendered.storageBody).toContain(
      'Follow &lt;b&gt;this&lt;/b&gt; instruction',
    );
    expect(rendered.storageBody).toContain(
      'href="https://jira.example.test/browse/ENG-42"',
    );
    expect(rendered.storageBody).not.toContain('javascript:');
    expect(rendered.storageBody).not.toContain('<script>');
    expect(rendered.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
