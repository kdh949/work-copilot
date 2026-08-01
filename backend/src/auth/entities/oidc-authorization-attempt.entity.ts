import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('oidc_authorization_attempts')
@Index('IDX_oidc_authorization_attempts_expiry', ['expiresAt'])
export class OidcAuthorizationAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 128, unique: true, select: false })
  stateHash: string;

  @Column({ type: 'varchar', length: 128, select: false })
  nonceHash: string;

  @Column({ type: 'text', select: false })
  pkceVerifierCiphertext: string;

  @Column({ type: 'varchar', length: 64, select: false })
  pkceVerifierIv: string;

  @Column({ type: 'varchar', length: 64, select: false })
  pkceVerifierTag: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
