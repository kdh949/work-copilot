import type { BriefPublication } from './entities/brief-publication.entity';
import type { PublicationStep } from './entities/publication-step.entity';
import type { DraftDeletionAssessment } from './publication.types';

export type StoredPublicationForDeletion = Pick<
  BriefPublication,
  'id' | 'draftId' | 'status' | 'executionMode' | 'confluenceContentId'
>;

export type StoredPublicationStepForDeletion = Pick<
  PublicationStep,
  'publicationId' | 'status' | 'providerObjectId' | 'errorCode'
>;

/**
 * Deletion must fail closed: the aggregate can lag a durable step result, and
 * an interrupted reconciliation cannot prove that a provider write did not
 * happen. This shared predicate is used by the delete guard and read-only
 * status presentations without calling an Atlassian API.
 */
export function assessPublicationDeletionSafety(
  publications: readonly StoredPublicationForDeletion[],
  steps: readonly StoredPublicationStepForDeletion[],
): DraftDeletionAssessment {
  const publicationById = new Map(
    publications.map((publication) => [publication.id, publication]),
  );
  const hasActivePublication = publications.some(
    (publication) =>
      publication.status === 'PENDING' || publication.status === 'PUBLISHING',
  );
  const hasRunningStep = steps.some((step) => step.status === 'RUNNING');
  const externalWritePerformed =
    publications.some(
      (publication) =>
        publication.executionMode === 'real' &&
        Boolean(publication.confluenceContentId),
    ) ||
    steps.some((step) => {
      if (step.errorCode === 'PUBLICATION_RECONCILIATION_INDETERMINATE') {
        return true;
      }
      const publication = publicationById.get(step.publicationId);
      return (
        publication?.executionMode === 'real' &&
        step.status === 'SUCCEEDED' &&
        Boolean(step.providerObjectId)
      );
    });

  return {
    publishing: hasActivePublication || hasRunningStep,
    externalWritePerformed,
  };
}

/**
 * SQL counterpart for retention queries. It uses the fixed aliases in the
 * cleanup query so callers cannot introduce SQL identifiers dynamically while
 * duplicating the fail-closed state definition above.
 */
export function publicationBlocksDraftDeletionSql(): string {
  return `
    publication."status" IN ('PENDING', 'PUBLISHING')
    OR step."status" = 'RUNNING'
    OR step."errorCode" = 'PUBLICATION_RECONCILIATION_INDETERMINATE'
    OR (
      publication."executionMode" = 'real'
      AND publication."confluenceContentId" IS NOT NULL
    )
    OR (
      publication."executionMode" = 'real'
      AND step."status" = 'SUCCEEDED'
      AND step."providerObjectId" IS NOT NULL
    )
  `;
}
