import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('single-server deployment configuration', () => {
  const repositoryRoot = join(__dirname, '../../..');

  it('uses a single-domain Compose stack instead of cloud deployment definitions', () => {
    const compose = readFileSync(join(repositoryRoot, 'compose.yaml'), 'utf8');
    const environmentExample = readFileSync(
      join(repositoryRoot, 'deploy/.env.production.example'),
      'utf8',
    );
    const nginx = readFileSync(
      join(repositoryRoot, 'frontend/nginx/default.conf'),
      'utf8',
    );

    expect(existsSync(join(repositoryRoot, 'render.yaml'))).toBe(false);
    expect(existsSync(join(repositoryRoot, 'vercel.json'))).toBe(false);
    expect(compose).toContain('name: work-copilot');
    expect(compose).toContain('image: pgvector/pgvector:pg16');
    expect(compose).toContain('SERVER_BIND_ADDRESS is required}:7236:8080');
    expect(compose).toContain('../node_modules/typeorm/cli.js');
    expect(compose).toContain('AI_SERVICE_URL: http://ai:8000');
    expect(environmentExample).toContain(
      'FRONTEND_ORIGINS=https://work-copilot.dhkim.cloud',
    );
    expect(environmentExample).toContain(
      'KEYCLOAK_REDIRECT_URI=https://work-copilot.dhkim.cloud/api/auth/oidc/callback',
    );
    expect(environmentExample).toContain(
      'INTEGRATION_CALLBACK_BASE_URL=https://work-copilot.dhkim.cloud/api',
    );
    expect(nginx).toContain('location /api/');
    expect(nginx).toContain('proxy_pass http://api:3000/;');
    expect(nginx).toContain('proxy_set_header X-Forwarded-Proto https;');
  });
});
