import { UnauthorizedException } from '@nestjs/common';

export const ACCOUNT_MAPPING_REJECTION_CODES = [
  'AUTH_MAPPED_IDENTITY_EMAIL_MISMATCH',
  'AUTH_PILOT_ACCOUNT_NOT_FOUND',
  'AUTH_ACCOUNT_MAPPED_TO_OTHER_IDENTITY',
] as const;

export type AccountMappingRejectionCode =
  (typeof ACCOUNT_MAPPING_REJECTION_CODES)[number];

/**
 * Records a fixed, non-identifying reason for a denied account mapping.
 */
export class AccountMappingRejectedException extends UnauthorizedException {
  constructor(readonly diagnosticCode: AccountMappingRejectionCode) {
    super('Authenticated account could not be mapped.');
  }
}
