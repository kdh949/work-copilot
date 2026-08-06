import assert from "node:assert/strict";
import test from "node:test";
import { loadDraftRoute } from "./draft-route-loader.ts";
import type {
  BriefDraft,
  BriefPublication,
  ReadinessAssessment,
} from "./work-briefs.types";

const draft = { id: "draft-1", optimisticVersion: 3 } as BriefDraft;
const publication = {
  id: "publication-1",
  draftId: "draft-1",
  draftVersion: 3,
} as BriefPublication;
const readiness = {
  draftId: "draft-1",
  assessmentVersion: 3,
  publishAllowed: true,
} as ReadinessAssessment;

test("reads a draft again for every route entry", async () => {
  const paths: string[] = [];
  const request = async <T>(path: string): Promise<T> => {
    paths.push(path);
    return (path.endsWith("/readiness")
      ? readiness
      : path.endsWith("/publication")
        ? publication
        : draft) as T;
  };

  await loadDraftRoute(request, draft.id);
  await loadDraftRoute(request, draft.id);

  assert.deepEqual(paths, [
    "/brief-drafts/draft-1",
    "/brief-drafts/draft-1/publication",
    "/brief-drafts/draft-1/readiness",
    "/brief-drafts/draft-1",
    "/brief-drafts/draft-1/publication",
    "/brief-drafts/draft-1/readiness",
  ]);
});

test("keeps a draft route usable when it has no publication yet", async () => {
  const request = async <T>(path: string): Promise<T> => {
    if (path.endsWith("/publication")) {
      throw Object.assign(new Error("not found"), { status: 404 });
    }
    return draft as T;
  };

  const loaded = await loadDraftRoute(request, draft.id);

  assert.equal(loaded.draft, draft);
  assert.equal(loaded.publication, null);
  assert.equal(loaded.readiness, null);
});

test("restores a current readiness assessment after loading publication progress", async () => {
  const paths: string[] = [];
  const request = async <T>(path: string): Promise<T> => {
    paths.push(path);
    return (path.endsWith("/readiness")
      ? readiness
      : path.endsWith("/publication")
        ? publication
        : draft) as T;
  };

  const loaded = await loadDraftRoute(request, draft.id);

  assert.equal(loaded.publication, publication);
  assert.equal(loaded.readiness, readiness);
  assert.deepEqual(paths, [
    "/brief-drafts/draft-1",
    "/brief-drafts/draft-1/publication",
    "/brief-drafts/draft-1/readiness",
  ]);
});

test("does not restore an assessment from a different draft version", async () => {
  const staleReadiness = {
    ...readiness,
    assessmentVersion: 2,
  } as ReadinessAssessment;
  const request = async <T>(path: string): Promise<T> =>
    (path.endsWith("/readiness")
      ? staleReadiness
      : path.endsWith("/publication")
        ? publication
        : draft) as T;

  const loaded = await loadDraftRoute(request, draft.id);

  assert.equal(loaded.readiness, null);
});
