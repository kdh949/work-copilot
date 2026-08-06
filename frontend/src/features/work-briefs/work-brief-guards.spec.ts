import assert from "node:assert/strict";
import test from "node:test";
import {
  canRunReadinessAssessment,
  canUsePublication,
  isReadinessAssessmentCurrent,
  publicationForCurrentDraft,
  withConnectionStatusRefresh,
} from "./work-brief-guards.ts";
import type {
  BriefDraft,
  BriefPublication,
  ReadinessAssessment,
} from "./work-briefs.types";

const draft = {
  optimisticVersion: 4,
  freshnessStatus: "current",
} as BriefDraft;

const readiness = { publishAllowed: true } as ReadinessAssessment;

test("blocks a readiness request while the editor has unsaved changes", () => {
  assert.equal(canRunReadinessAssessment(true), false);
  assert.equal(canUsePublication(draft, readiness, true), false);
});

test("does not accept a readiness result after the editor changes in flight", () => {
  const requestedEditRevision = 8;
  const currentEditRevision = requestedEditRevision + 1;

  assert.equal(
    isReadinessAssessmentCurrent(
      requestedEditRevision,
      currentEditRevision,
    ),
    false,
  );
  assert.equal(
    isReadinessAssessmentCurrent(requestedEditRevision, requestedEditRevision),
    true,
  );
});

test("keeps an older publication as history instead of resuming it", () => {
  const previousPublication = {
    draftVersion: 3,
  } as BriefPublication;

  assert.equal(
    publicationForCurrentDraft(previousPublication, draft),
    null,
  );
  assert.equal(
    publicationForCurrentDraft(
      { ...previousPublication, draftVersion: 4 },
      draft,
    )?.draftVersion,
    4,
  );
});

test("refreshes connection status after successful and failed provider calls", async () => {
  let refreshCount = 0;
  const refreshConnections = async () => {
    refreshCount += 1;
  };

  await withConnectionStatusRefresh(async () => "ok", refreshConnections);
  await assert.rejects(
    withConnectionStatusRefresh(
      async () => Promise.reject(new Error("token rejected")),
      refreshConnections,
    ),
    /token rejected/,
  );

  await assert.doesNotReject(
    withConnectionStatusRefresh(
      async () => "ok",
      async () => Promise.reject(new Error("status lookup unavailable")),
    ),
  );

  assert.equal(refreshCount, 2);
});
