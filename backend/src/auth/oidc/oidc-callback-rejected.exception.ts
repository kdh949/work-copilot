import { UnauthorizedException } from '@nestjs/common';

export const OIDC_REJECTION_CODES = [
  'OIDC_CALLBACK_INVALID',
  'OIDC_ATTEMPT_INVALID_OR_EXPIRED',
  'OIDC_TOKEN_RESPONSE_INVALID',
  'OIDC_ID_TOKEN_INVALID',
  'OIDC_VERIFIED_EMAIL_REQUIRED',
  'OIDC_EMAIL_DOMAIN_NOT_ALLOWED',
] as const;

export type OidcRejectionCode = (typeof OIDC_REJECTION_CODES)[number];

/**
 * Keeps OIDC failure diagnostics safe for server logs without exposing them
 * in the public API response.
 */
export class OidcCallbackRejectedException extends UnauthorizedException {
  constructor(readonly diagnosticCode: OidcRejectionCode) {
    super('OIDC callback was rejected.');
  }
}
