import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, LessThanOrEqual, Repository } from 'typeorm';
import { Post } from '../posts/post.entity';
import { AiService } from './ai.service';
import { AiSyncOutbox, type AiSyncOperation } from './ai-sync-outbox.entity';

const MAX_SYNC_ATTEMPTS = 5;
const RETRY_INTERVAL_MS = 30_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

@Injectable()
export class AiSyncService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private activeProcessing?: Promise<void>;
  private isProcessing = false;
  private isShuttingDown = false;

  constructor(
    @InjectRepository(AiSyncOutbox)
    private readonly outboxRepository: Repository<AiSyncOutbox>,
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
    private readonly aiService: AiService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.trigger();
    }, RETRY_INTERVAL_MS);
    this.trigger();
  }

  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;

    if (this.timer) {
      clearInterval(this.timer);
    }

    await this.activeProcessing?.catch(() => undefined);
  }

  async enqueue(
    manager: EntityManager,
    sourceId: string,
    operation: AiSyncOperation,
  ): Promise<AiSyncOutbox> {
    const repository = manager.getRepository(AiSyncOutbox);
    const existing = await repository.findOne({
      where: {
        sourceId,
        status: In(['pending', 'retry']),
      },
      order: {
        id: 'DESC',
      },
    });

    if (existing) {
      existing.operation = operation;
      existing.status = 'pending';
      existing.attempts = 0;
      existing.nextAttemptAt = new Date();
      existing.lastError = null;
      return repository.save(existing);
    }

    return repository.save(
      repository.create({
        sourceId,
        operation,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: null,
      }),
    );
  }

  trigger(): void {
    if (this.isShuttingDown || this.activeProcessing) {
      return;
    }

    const processing = this.processPendingJobs();
    this.activeProcessing = processing;
    void processing
      .catch(() => undefined)
      .finally(() => {
        if (this.activeProcessing === processing) {
          this.activeProcessing = undefined;
        }
      });
  }

  async retryFailed(sourceId: string): Promise<number> {
    const result = await this.outboxRepository.update(
      {
        sourceId,
        status: 'failed',
      },
      {
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: null,
      },
    );
    this.trigger();
    return result.affected || 0;
  }

  async getSummary(): Promise<Record<string, number>> {
    const rows = await this.outboxRepository
      .createQueryBuilder('outbox')
      .select('outbox.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('outbox.status')
      .getRawMany<{ status: string; count: string }>();

    return rows.reduce<Record<string, number>>((summary, row) => {
      summary[row.status] = Number(row.count);
      return summary;
    }, {});
  }

  async processPendingJobs(): Promise<void> {
    if (this.isProcessing || this.isShuttingDown) {
      return;
    }

    this.isProcessing = true;

    try {
      const jobs = await this.outboxRepository.find({
        where: {
          status: In(['pending', 'retry']),
          nextAttemptAt: LessThanOrEqual(new Date()),
        },
        order: {
          id: 'ASC',
        },
        take: 10,
      });

      for (const job of jobs) {
        await this.processJob(job);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async processJob(job: AiSyncOutbox): Promise<void> {
    try {
      if (job.operation === 'delete') {
        await this.aiService.deleteDocumentBySourceId(job.sourceId);
      } else {
        const post = await this.findPost(job.sourceId);

        if (post) {
          await this.aiService.syncPost(post);
        }
      }

      job.status = 'completed';
      job.lastError = null;
      await this.outboxRepository.save(job);
    } catch (error) {
      job.attempts += 1;
      job.lastError =
        error instanceof Error
          ? error.message.slice(0, 1_000)
          : 'AI 동기화 실패';
      job.status = job.attempts >= MAX_SYNC_ATTEMPTS ? 'failed' : 'retry';
      job.nextAttemptAt = new Date(Date.now() + this.retryDelay(job.attempts));
      await this.outboxRepository.save(job);
    }
  }

  private async findPost(sourceId: string): Promise<Post | null> {
    const legacyPostId = /^post-(\d+)$/.exec(sourceId)?.[1];

    if (legacyPostId) {
      return this.postRepository.findOne({
        where: { id: Number(legacyPostId) },
      });
    }

    return this.postRepository.findOne({ where: { sourceId } });
  }

  private retryDelay(attempt: number): number {
    return Math.min(2 ** attempt * 1_000, MAX_RETRY_DELAY_MS);
  }
}
