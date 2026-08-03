import {
  configureTrustProxy,
  parseFrontendOrigins,
  parseTrustProxyHops,
} from './security.config';

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

  it('requires explicit proxy trust in production and keeps local development direct', () => {
    expect(parseTrustProxyHops(undefined, 'development')).toBe(0);
    expect(() => parseTrustProxyHops(undefined, 'production')).toThrow(
      'TRUST_PROXY_HOPS is required in production.',
    );
  });

  it('accepts a bounded integer proxy-hop count', () => {
    expect(parseTrustProxyHops('2', 'production')).toBe(2);
    expect(() => parseTrustProxyHops('-1', 'production')).toThrow();
    expect(() => parseTrustProxyHops('1.5', 'production')).toThrow();
    expect(() => parseTrustProxyHops('6', 'production')).toThrow();
  });

  it('configures Express with the selected trusted proxy count', () => {
    const application = { set: jest.fn() };

    configureTrustProxy(application, 2);

    expect(application.set).toHaveBeenCalledWith('trust proxy', 2);
  });
});
