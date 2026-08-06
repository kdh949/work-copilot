import type {
  BriefDraft,
  BriefPublication,
  ReadinessAssessment,
  WorkBriefApiRequest,
} from "./work-briefs.types";

export type LoadedDraftRoute = {
  draft: BriefDraft;
  publication: BriefPublication | null;
  readiness: ReadinessAssessment | null;
};

/**
 * Loads the persistent state for an editor URL. This deliberately has no
 * module-level "already opened" flag: every route entry must read the server
 * again so a deletion or edit from another tab cannot leave the editor stale.
 */
export async function loadDraftRoute(
  request: WorkBriefApiRequest,
  draftId: string,
): Promise<LoadedDraftRoute> {
  const draft = await request<BriefDraft>(`/brief-drafts/${draftId}`);

  try {
    const publication = await request<BriefPublication>(
      `/brief-drafts/${draftId}/publication`,
    );
    if (publication.draftVersion !== draft.optimisticVersion) {
      return { draft, publication, readiness: null };
    }

    try {
      const readiness = await request<ReadinessAssessment>(
        `/brief-drafts/${draftId}/readiness`,
      );
      // This endpoint calculates from the live draft. Retain the check so a
      // future cached implementation cannot enable a retry for an older
      // version of the editor.
      return {
        draft,
        publication,
        readiness:
          readiness.assessmentVersion === draft.optimisticVersion
            ? readiness
            : null,
      };
    } catch {
      return { draft, publication, readiness: null };
    }
  } catch {
    // A draft without any publication is the normal first-open state. The
    // editor will let the user begin readiness assessment from there.
    return { draft, publication: null, readiness: null };
  }
}
