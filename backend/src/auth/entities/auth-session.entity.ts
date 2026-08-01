import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/user.entity';

@Entity('auth_sessions')
@Index('IDX_auth_sessions_active', ['userId', 'expiresAt'], {
  where: '"revokedAt" IS NULL',
})
export class AuthSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 128, unique: true, select: false })
  sessionTokenHash: string;

  @Column({ type: 'int' })
  userId: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'varchar', length: 128, select: false })
  csrfSecretHash: string;

  @Column({ type: 'boolean', default: false })
  isWorkCopilotAdmin: boolean;

  @Column({ type: 'timestamptz' })
  rotatedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
