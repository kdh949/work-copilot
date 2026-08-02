import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ReadinessFinding, ReadinessStatus } from '../readiness.types';

@Entity('readiness_assessments')
export class ReadinessAssessment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  draftId: string;

  @Column({ type: 'varchar' })
  sourceJiraId: string;

  @Column({ type: 'int' })
  assessmentVersion: number;

  @Column({ type: 'varchar', length: 32 })
  status: ReadinessStatus;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  findings: ReadinessFinding[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
