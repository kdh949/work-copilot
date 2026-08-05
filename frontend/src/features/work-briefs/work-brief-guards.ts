import type {
  BriefDraft,
  BriefPublication,
  ReadinessAssessment,
} from "./work-briefs.types";

/** A readiness result is usable only if the editor stayed unchanged in flight. */
export function isReadinessAssessmentCurrent(
  requestedEditRevision: number,
  currentEditRevision: number,
): boolean {
  return requestedEditRevision === currentEditRevision;
}

export function canRunReadinessAssessment(readinessStale: boolean): boolean {
  return !readinessStale;
}

export function canUsePublication(
  draft: BriefDraft | null,
  readiness: ReadinessAssessment | null,
  readinessStale: boolean,
): boolean {
  return Boolean(
    draft &&
      readiness?.publishAllowed &&
      draft.freshnessStatus === "current" &&
      !readinessStale,
  );
}

/**
 * A publication belongs to a specific persisted draft version. Older records
 * are history, not a continuation target for the current version.
 */
export function publicationForCurrentDraft(
  publication: BriefPublication | null,
  draft: BriefDraft | null,
): BriefPublication | null {
  if (!publication || !draft) return null;
  return publication.draftVersion === draft.optimisticVersion
    ? publication
    : null;
}

/**
 * Provider calls can mutate an OAuth connection (for example after a refresh
 * token failure). Refresh the status on both success and failure without
 * replacing the original operation result.
 */
export async function withConnectionStatusRefresh<T>(
  operation: () => Promise<T>,
  refreshConnections: () => Promise<void>,
): Promise<T> {
  try {
    return await operation();
  } finally {
    try {
      void refreshConnections().catch(() => undefined);
    } catch {
      // Connection status is best-effort and must not replace the operation
      // outcome when a caller supplies a synchronous implementation.
    }
  }
}
