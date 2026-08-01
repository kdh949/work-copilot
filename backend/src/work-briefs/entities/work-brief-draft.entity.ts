import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  BriefContent,
  DraftFreshnessStatus,
  DraftStatus,
  StoredBriefEvidence,
} from '../brief-draft.types';

@Entity('work_brief_drafts')
export class WorkBriefDraft {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  profileId: string;

  @Column({ type: 'int' })
  createdByUserId: number;

  @Column({ type: 'varchar' })
  sourceJiraId: string;

  @Column({ type: 'varchar' })
  sourceJiraKey: string;

  @Column({ type: 'varchar' })
  sourceJiraVersion: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  maskedBrief: BriefContent;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  evidence: StoredBriefEvidence[];

  @Column({ type: 'varchar', length: 32, default: 'draft' })
  status: DraftStatus;

  @Column({ type: 'int', default: 1 })
  optimisticVersion: number;

  @Column({ type: 'varchar', length: 32, default: 'current' })
  freshnessStatus: DraftFreshnessStatus;

  @Column({ type: 'int', default: 1 })
  policyVersion: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
