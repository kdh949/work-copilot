import { createHash } from 'node:crypto';

const MAX_CONFLUENCE_TITLE_LENGTH = 255;

/**
 * A deterministic title marker is used for safe reconciliation because the
 * Data Center content-property endpoint is not available to every OAuth2
 * deployment. It is derived from immutable approved content, not a browser
 * request key.
 */
export function confluencePublicationTitle(
  renderedTitle: string,
  draftId: string,
  contentHash: string,
): string {
  const marker = createHash('sha256')
    .update(`${draftId}:${contentHash}`)
    .digest('hex')
    .slice(0, 12);
  const suffix = ` [WC:${marker}]`;
  return `${renderedTitle.slice(0, MAX_CONFLUENCE_TITLE_LENGTH - suffix.length)}${suffix}`;
}
