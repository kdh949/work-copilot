const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:5173';

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
