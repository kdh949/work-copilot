import { TransientEvidenceFragmentsService } from './transient-evidence-fragments.service';

type StoredFragment = {
  draftId: string;
  evidenceId: string;
  ciphertext: string;
  iv: string;
  authenticationTag: string;
  encryptionKeyVersion: number;
  expiresAt: Date;
};

type FindOptions = { where: { expiresAt: unknown } };

describe('TransientEvidenceFragmentsService', () => {
  const repository = {
    upsert: jest.fn<Promise<void>, [StoredFragment, string[]]>(),
    find: jest.fn<Promise<StoredFragment[]>, [FindOptions]>(),
    delete: jest.fn<Promise<void>, [unknown]>(),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'TRANSIENT_EVIDENCE_TTL_SECONDS') {
        return '86400';
      }
      if (key === 'TRANSIENT_EVIDENCE_PURGE_INTERVAL_SECONDS') {
        return '900';
      }
      return undefined;
    }),
  };
  const cryptoService = {
    encrypt: jest.fn(() => ({
      ciphertext: 'encrypted-only',
      iv: 'iv',
      authenticationTag: 'tag',
      encryptionKeyVersion: 1,
    })),
    decrypt: jest.fn(() => 'decrypted only in memory'),
  };
  const contentGuard = { assertSafeFragment: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createService(): TransientEvidenceFragmentsService {
    return new TransientEvidenceFragmentsService(
      repository as never,
      configService as never,
      cryptoService as never,
      contentGuard as never,
    );
  }

  it('stores only encrypted transient evidence with a maximum 24-hour expiry', async () => {
    await createService().store(
      'draft-id',
      'jira:DEMO-1',
      'original evidence text',
    );

    expect(contentGuard.assertSafeFragment).toHaveBeenCalledWith(
      'jira:DEMO-1',
      'original evidence text',
    );
    const stored = repository.upsert.mock.calls[0]?.[0];
    expect(stored).toEqual(
      expect.objectContaining({
        ciphertext: 'encrypted-only',
        evidenceId: 'jira:DEMO-1',
      }),
    );
    expect(JSON.stringify(stored)).not.toContain('original evidence text');
    expect(stored?.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 24 * 60 * 60 * 1_000 + 1_000,
    );
  });

  it('filters expired rows on read and purges them without evidence logging', async () => {
    repository.find.mockResolvedValue([
      {
        draftId: 'draft-id',
        evidenceId: 'jira:DEMO-1',
        ciphertext: 'encrypted-only',
        iv: 'iv',
        authenticationTag: 'tag',
        encryptionKeyVersion: 1,
        expiresAt: new Date(),
      },
    ]);
    const service = createService();

    await expect(service.readActive('draft-id')).resolves.toEqual([
      { evidenceId: 'jira:DEMO-1', content: 'decrypted only in memory' },
    ]);
    await service.purgeExpired();

    expect(repository.find.mock.calls[0]?.[0].where.expiresAt).toBeDefined();
    expect(repository.delete).toHaveBeenCalledTimes(1);
  });

  it('reports encrypted-evidence cleanup health without retaining any cleanup error', async () => {
    const cleanupHealth = {
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    };
    repository.delete.mockResolvedValueOnce({ affected: 3 } as never);
    const service = new TransientEvidenceFragmentsService(
      repository as never,
      configService as never,
      cryptoService as never,
      contentGuard as never,
      cleanupHealth as never,
    );

    await service.purgeExpired();
    repository.delete.mockRejectedValueOnce(new Error('database error'));
    await service.purgeExpired();

    expect(cleanupHealth.recordSuccess).toHaveBeenCalledWith(
      'transient_evidence',
      3,
    );
    expect(cleanupHealth.recordFailure).toHaveBeenCalledWith(
      'transient_evidence',
    );
  });
});
