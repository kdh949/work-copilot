import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { IntegrationProvider } from '../../profiles/integration-profile-url.policy';

@Entity('oauth_authorization_attempts')
@Index('IDX_oauth_authorization_attempts_expiry', ['expiresAt'])
export class OAuthAuthorizationAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32 })
  provider: IntegrationProvider;

  @Column({ type: 'int' })
  userId: number;

  @Column({ type: 'uuid' })
  profileId: string;

  @Column({ type: 'varchar', length: 128, unique: true, select: false })
  stateHash: string;

  @Column({ type: 'text', select: false })
  pkceVerifierCiphertext: string;

  @Column({ type: 'varchar', length: 64, select: false })
  pkceVerifierIv: string;

  @Column({ type: 'varchar', length: 64, select: false })
  pkceVerifierTag: string;

  @Column({ type: 'int' })
  encryptionKeyVersion: number;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
