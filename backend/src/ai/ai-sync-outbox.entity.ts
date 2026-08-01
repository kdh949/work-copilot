import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type AiSyncOperation = 'upsert' | 'delete';
export type AiSyncStatus = 'pending' | 'retry' | 'completed' | 'failed';

@Entity('ai_sync_outbox')
@Index('IDX_ai_sync_outbox_pending', ['status', 'nextAttemptAt'])
export class AiSyncOutbox {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar', length: 100 })
    sourceId: string;

    @Column({ type: 'varchar', length: 16 })
    operation: AiSyncOperation;

    @Column({ type: 'varchar', length: 16, default: 'pending' })
    status: AiSyncStatus;

    @Column({ type: 'int', default: 0 })
    attempts: number;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    nextAttemptAt: Date;

    @Column({ type: 'text', nullable: true })
    lastError: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
