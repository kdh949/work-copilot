import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Render deployment configuration', () => {
  it('points the production frontend at the work-copilot API service', () => {
    const renderConfig = readFileSync(
      join(__dirname, '../../../render.yaml'),
      'utf8',
    );

    expect(renderConfig).toMatch(
      /- key: VITE_API_URL\s+value: https:\/\/work-copilot-api\.onrender\.com/,
    );
    expect(renderConfig).not.toContain('week15-board-api.onrender.com');
    expect(renderConfig).toMatch(
      /- key: OPENAI_STORE\s+value: "false"/,
    );
    expect(renderConfig).toMatch(
      /- key: TRANSIENT_CONTENT_ENCRYPTION_KEY_VERSION\s+value: "1"/,
    );
  });
});
