import type { EntityManager } from 'typeorm';

/**
 * Serializes the irreversible choice for one draft: reserve its first
 * publication or soft-delete it. The transaction-scoped advisory lock is
 * released automatically on commit or rollback, including process failures.
 */
export async function lockBriefDraft(
  manager: Pick<EntityManager, 'query'>,
  draftId: string,
): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `work-brief-draft:${draftId}`,
  ]);
}
