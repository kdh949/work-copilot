import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SourceChangeProvider = 'jira' | 'confluence';

@Entity('source_change_events')
export class SourceChangeEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32 })
  provider: SourceChangeProvider;

  @Column({ type: 'uuid' })
  profileId: string;

  @Column({ type: 'varchar' })
  sourceId: string;

  @Column({ type: 'varchar', nullable: true })
  sourceVersion: string | null;

  @Column({ type: 'timestamptz' })
  eventTime: Date;

  @Column({ type: 'varchar', length: 128 })
  eventFingerprint: string;

  @Column({ type: 'varchar', length: 32 })
  ingressAuthResult: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
