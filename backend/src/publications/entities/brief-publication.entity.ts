import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  PublicationExecutionMode,
  PublicationStatus,
} from '../publication.types';

@Entity('brief_publications')
export class BriefPublication {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  draftId: string;

  @Column({ type: 'uuid' })
  operationId: string;

  @Column({ type: 'varchar', length: 128 })
  idempotencyKeyHash: string;

  @Column({ type: 'int' })
  draftVersion: number;

  @Column({ type: 'varchar', length: 32, default: 'PENDING' })
  status: PublicationStatus;

  @Column({ type: 'varchar', nullable: true })
  confluenceContentId: string | null;

  @Column({ type: 'varchar', nullable: true })
  jiraRemoteLinkId: string | null;

  @Column({ type: 'int', nullable: true })
  approvedByUserId: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'varchar', length: 16, default: 'mock' })
  executionMode: PublicationExecutionMode;

  @Column({ type: 'timestamptz', nullable: true })
  reviewRequiredAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
