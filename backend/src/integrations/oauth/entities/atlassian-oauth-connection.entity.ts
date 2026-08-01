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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
