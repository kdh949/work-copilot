import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { WorkBriefContentGuard } from './work-brief-content-guard.service';
import { TransientEvidenceCryptoService } from './transient-evidence-crypto.service';
import { TransientEvidenceFragment } from './entities/transient-evidence-fragment.entity';
import { CleanupHealthService } from '../operations/cleanup-health.service';

const MAX_TTL_SECONDS = 24 * 60 * 60;

export type ActiveEvidenceFragment = {
  evidenceId: string;
  content: string;
};

@Injectable()
export class TransientEvidenceFragmentsService
  implements OnModuleInit, OnModuleDestroy
{
  private purgeTimer: NodeJS.Timeout | undefined;

  constructor(
    @InjectRepository(TransientEvidenceFragment)
    private readonly fragmentsRepository: Repository<TransientEvidenceFragment>,
    private readonly configService: ConfigService,
    private readonly cryptoService: TransientEvidenceCryptoService,
    private readonly contentGuard: WorkBriefContentGuard,
    @Optional() private readonly cleanupHealth?: CleanupHealthService,
  ) {}

  onModuleInit(): void {
    void this.purgeExpired();
    this.purgeTimer = setInterval(() => {
      void this.purgeExpired();
    }, this.getPurgeIntervalSeconds() * 1_000);
    this.purgeTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.purgeTimer) {
      clearInterval(this.purgeTimer);
      this.purgeTimer = undefined;
    }
  }

  async store(
    draftId: string,
    evidenceId: string,
    content: string,
  ): Promise<void> {
    this.contentGuard.assertSafeFragment(evidenceId, content);
    const encrypted = this.cryptoService.encrypt(content);
    const expiresAt = new Date(Date.now() + this.getTtlSeconds() * 1_000);

    await this.fragmentsRepository.upsert(
      {
        draftId,
        evidenceId,
        ...encrypted,
        expiresAt,
      },
      ['draftId', 'evidenceId'],
    );
  }

  async readActive(draftId: string): Promise<ActiveEvidenceFragment[]> {
    const fragments = await this.fragmentsRepository.find({
      select: {
        id: true,
        evidenceId: true,
        ciphertext: true,
        iv: true,
        authenticationTag: true,
        encryptionKeyVersion: true,
      },
      where: {
        draftId,
        expiresAt: MoreThan(new Date()),
      },
    });

    return Promise.all(
      fragments.map(async (fragment) => {
        const content = this.cryptoService.decrypt(fragment);

        if (
          this.cryptoService.needsReencryption(fragment.encryptionKeyVersion)
        ) {
          const encrypted = this.cryptoService.encrypt(content);
          await this.fragmentsRepository.update({ id: fragment.id }, encrypted);
        }

        return { evidenceId: fragment.evidenceId, content };
      }),
    );
  }

  /**
   * Hard-delete every fragment of one draft.
   *
   * The table's `ON DELETE CASCADE` only fires on a real row delete, so a
   * soft-deleted draft would otherwise keep its encrypted excerpts around
   * until their TTL expired.  Deletion must not extend retention.
   */
  async purgeDraft(draftId: string): Promise<number> {
    const result = await this.fragmentsRepository.delete({ draftId });

    return result.affected ?? 0;
  }

  async purgeExpired(): Promise<void> {
    try {
      const result = await this.fragmentsRepository.delete({
        expiresAt: LessThanOrEqual(new Date()),
      });
      this.cleanupHealth?.recordSuccess(
        'transient_evidence',
        result.affected ?? 0,
      );
    } catch {
      // Purges never include evidence data in errors or logs.
      this.cleanupHealth?.recordFailure('transient_evidence');
    }
  }

  private getTtlSeconds(): number {
    return this.readBoundedPositiveInteger(
      'TRANSIENT_EVIDENCE_TTL_SECONDS',
      MAX_TTL_SECONDS,
      MAX_TTL_SECONDS,
    );
  }

  private getPurgeIntervalSeconds(): number {
    return this.readBoundedPositiveInteger(
      'TRANSIENT_EVIDENCE_PURGE_INTERVAL_SECONDS',
      15 * 60,
      60 * 60,
    );
  }

  private readBoundedPositiveInteger(
    key: string,
    defaultValue: number,
    maxValue: number,
  ): number {
    const configured = this.configService.get<string>(key);
    if (!configured) {
      return defaultValue;
    }

    const value = Number(configured);
    return Number.isInteger(value) && value >= 60 && value <= maxValue
      ? value
      : defaultValue;
  }
}
