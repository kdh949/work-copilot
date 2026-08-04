import { confluencePublicationTitle } from './confluence-publication-title';

describe('confluencePublicationTitle', () => {
  it('is deterministic for approved content and fits the provider title limit', () => {
    const title = confluencePublicationTitle(
      '가'.repeat(300),
      'draft-1',
      'a'.repeat(64),
    );

    expect(title).toContain('[WC:');
    expect(title).toHaveLength(255);
    expect(confluencePublicationTitle('제목', 'draft-1', 'a'.repeat(64))).toBe(
      confluencePublicationTitle('제목', 'draft-1', 'a'.repeat(64)),
    );
  });
});
