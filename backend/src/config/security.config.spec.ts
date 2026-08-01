import { parseFrontendOrigins } from './security.config';

describe('parseFrontendOrigins', () => {
  it('normalizes a comma-separated allowlist', () => {
    expect(
      parseFrontendOrigins(
        'https://app.example.com, http://localhost:5173/path',
      ),
    ).toEqual(['https://app.example.com', 'http://localhost:5173']);
  });

  it('rejects malformed origins at startup', () => {
    expect(() => parseFrontendOrigins('not an origin')).toThrow();
  });

  it('requires an explicit allowlist in production', () => {
    expect(() => parseFrontendOrigins(undefined, 'production')).toThrow(
      'FRONTEND_ORIGINS is required in production.',
    );
  });
});
