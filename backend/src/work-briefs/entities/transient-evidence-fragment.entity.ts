import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('transient_evidence_fragments')
export class TransientEvidenceFragment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  draftId: string;

  @Column()
  evidenceId: string;

  @Column({ type: 'text', select: false })
  ciphertext: string;

  @Column({ type: 'varchar', length: 64, select: false })
  iv: string;

  @Column({ type: 'varchar', length: 64, select: false })
  authenticationTag: string;

  @Column({ type: 'int', default: 1 })
  encryptionKeyVersion: number;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
