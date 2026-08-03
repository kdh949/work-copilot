import { BadRequestException } from '@nestjs/common';

/**
 * Fixed, non-sensitive reasons that an administrator can act on without
 * exposing submitted URLs, credentials, or provider responses.
 */
export const INTEGRATION_PROFILE_REJECTION_CODES = [
  'INTEGRATION_PROFILE_BASE_URL_INVALID',
  'INTEGRATION_PROFILE_BASE_URL_HOST_NOT_ALLOWLISTED',
  'INTEGRATION_PROFILE_BASE_URL_HOST_ALLOWLIST_NOT_CONFIGURED',
  'INTEGRATION_PROFILE_SCOPE_ALLOWLIST_NOT_CONFIGURED',
  'INTEGRATION_PROFILE_SCOPE_NOT_ALLOWLISTED',
] as const;

export type IntegrationProfileRejectionCode =
  (typeof INTEGRATION_PROFILE_REJECTION_CODES)[number];

export class IntegrationProfileRejectedException extends BadRequestException {
  constructor(readonly diagnosticCode: IntegrationProfileRejectionCode) {
    super('Integration profile was rejected.');
  }
}
