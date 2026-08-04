import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { IntegrationProvider } from '../../profiles/integration-profile-url.policy';

export type OAuthConnectionStatus =
  'connected' | 'expired' | 'reauthorization_required';

@Entity('atlassian_oauth_connections')
@Index(
  'UQ_atlassian_oauth_connections_user_profile_provider',
  ['userId', 'profileId', 'provider'],
  { unique: true },
)
export class AtlassianOAuthConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int' })
  userId: number;

  @Column({ type: 'uuid' })
  profileId: string;

  @Column({ type: 'varchar', length: 32 })
  provider: IntegrationProvider;

  @Column({ type: 'text', select: false })
  tokensCiphertext: string;

  @Column({ type: 'varchar', length: 64, select: false })
  tokensIv: string;

  @Column({ type: 'varchar', length: 64, select: false })
  tokensTag: string;

  @Column({ type: 'int' })
  encryptionKeyVersion: number;

  @Column({ type: 'timestamptz', nullable: true })
  tokenExpiresAt: Date | null;

  @Column({ type: 'int', default: 1 })
  tokenVersion: number;

  @Column({ type: 'varchar', length: 32, default: 'connected' })
  status: OAuthConnectionStatus;

  /**
   * Hash of the normalized scope set used in the user consent flow. It lets
   * us distinguish an old read-only grant from a later profile change that
   * requests write authority.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  scopeFingerprint: string | null;

  /**
   * Normalized scopes shown in the completed user-consent flow.  This is kept
   * alongside the fingerprint because a later profile scope expansion must
   * not invalidate capabilities that the user already granted.
   */
  @Column({ type: 'jsonb', nullable: true })
  grantedScopes: string[] | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
