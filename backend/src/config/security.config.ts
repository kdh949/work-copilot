const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:5173';
const MAX_TRUST_PROXY_HOPS = 5;

export const CSRF_HEADER_NAME = 'x-csrf-token';

export const parseFrontendOrigins = (
  value: string | undefined,
  environment = process.env.NODE_ENV,
): string[] => {
  if (!value && environment === 'production') {
    throw new Error('FRONTEND_ORIGINS is required in production.');
  }

  const origins = (value ?? DEFAULT_FRONTEND_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error('FRONTEND_ORIGINS must include at least one origin.');
  }

  return origins.map((origin) => new URL(origin).origin);
};

export const isAllowedOrigin = (
  origin: string,
  allowedOrigins: readonly string[],
): boolean => allowedOrigins.includes(origin);

export const parseTrustProxyHops = (
  value: string | undefined,
  environment = process.env.NODE_ENV,
): number => {
  const normalized = value?.trim();

  if (!normalized) {
    if (environment === 'production') {
      throw new Error('TRUST_PROXY_HOPS is required in production.');
    }

    return 0;
  }

  const hops = Number(normalized);
  if (
    !Number.isInteger(hops) ||
    hops < 0 ||
    hops > MAX_TRUST_PROXY_HOPS
  ) {
    throw new Error(
      `TRUST_PROXY_HOPS must be an integer between 0 and ${MAX_TRUST_PROXY_HOPS}.`,
    );
  }

  return hops;
};

export type TrustProxyApplication = {
  set(setting: 'trust proxy', value: number): unknown;
};

export const configureTrustProxy = (
  application: TrustProxyApplication,
  hops: number,
): void => {
  application.set('trust proxy', hops);
};
