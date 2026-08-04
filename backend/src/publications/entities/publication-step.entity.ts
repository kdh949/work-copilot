import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  PublicationErrorCode,
  PublicationPhase,
  PublicationStepStatus,
} from '../publication.types';

@Entity('publication_steps')
export class PublicationStep {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  publicationId: string;

  @Column({ type: 'varchar', length: 64 })
  stepKey: string;

  @Column({ type: 'varchar', length: 32, default: 'confluence' })
  phase: PublicationPhase;

  @Column({ type: 'varchar', length: 32, default: 'PENDING' })
  status: PublicationStepStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  errorCode: PublicationErrorCode | null;

  @Column({ type: 'varchar', nullable: true })
  providerObjectId: string | null;

  @Column({ type: 'varchar', nullable: true })
  providerObjectVersion: string | null;

  @Column({ type: 'text', nullable: true })
  providerUrl: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  contentHash: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  idempotencyKeyHash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  executionLeaseExpiresAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
