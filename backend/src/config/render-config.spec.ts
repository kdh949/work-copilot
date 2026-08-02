import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('production deployment configuration', () => {
  it('uses Render for APIs and Vercel for the frontend', () => {
    const renderConfig = readFileSync(
      join(__dirname, '../../../render.yaml'),
      'utf8',
    );
    const vercelConfig = readFileSync(
      join(__dirname, '../../../vercel.json'),
      'utf8',
    );

    expect(renderConfig).not.toContain('name: work-copilot-web');
    expect(renderConfig).not.toContain('week15-board-api.onrender.com');
    expect(renderConfig).not.toContain('branch: feature/rename-work-copilot');
    expect(renderConfig.match(/branch: main/g)).toHaveLength(2);
    expect(renderConfig).toMatch(/- key: OPENAI_STORE\s+value: "false"/);
    expect(renderConfig).toMatch(
      /- key: TRANSIENT_CONTENT_ENCRYPTION_KEY_VERSION\s+value: "1"/,
    );
    expect(renderConfig).toMatch(
      /- key: INTEGRATION_ENCRYPTION_PREVIOUS_KEY\s+sync: false/,
    );
    expect(renderConfig).toMatch(
      /- key: INTEGRATION_ENCRYPTION_PREVIOUS_KEY_VERSION\s+sync: false/,
    );
    expect(renderConfig).toMatch(
      /- key: TRANSIENT_CONTENT_ENCRYPTION_PREVIOUS_KEY\s+sync: false/,
    );
    expect(renderConfig).toMatch(
      /- key: TRANSIENT_CONTENT_ENCRYPTION_PREVIOUS_KEY_VERSION\s+sync: false/,
    );
    expect(vercelConfig).toContain('"outputDirectory": "frontend/dist"');
    expect(vercelConfig).toContain(
      '"VITE_API_URL": "https://api.work-copilot.dhkim.cloud"',
    );
    expect(vercelConfig).toContain('"destination": "/index.html"');
    expect(renderConfig).toContain(
      'value: https://work-copilot.dhkim.cloud,https://work-copilot-web.vercel.app',
    );
    expect(renderConfig).toContain(
      'value: https://api.work-copilot.dhkim.cloud/auth/oidc/callback',
    );
    expect(renderConfig).toContain(
      'value: https://work-copilot-ai.onrender.com',
    );
  });
});
