import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteRejectionReason,
  draftEvidenceCountText,
  draftPublicationLabel,
  draftTitleText,
} from "./brief-draft-list-copy.ts";
import type { BriefDraftSummary } from "./work-briefs.types";

const summary = (overrides: Partial<BriefDraftSummary> = {}) =>
  ({
    id: "draft-1",
    sourceJiraKey: "PROJ-284",
    title: "결제 재시도 정책 브리프",
    evidenceCount: 5,
    status: "draft",
    freshnessStatus: "current",
    optimisticVersion: 1,
    blockers: [],
    publication: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  }) as BriefDraftSummary;

test("says the title is withheld instead of substituting the issue key", () => {
  const withheld = summary({ title: null, evidenceCount: null });

  assert.equal(draftTitleText(summary()), "결제 재시도 정책 브리프");
  assert.ok(draftTitleText(withheld).includes("표시할 수 없습니다"));
  assert.ok(!draftTitleText(withheld).includes("PROJ-284"));
  assert.equal(draftEvidenceCountText(withheld), "근거 수 확인 불가");
  assert.equal(draftEvidenceCountText(summary()), "근거 5건");
});

// External write history is what blocks deletion, so the badge has to show it
// even when a later status would otherwise read as harmless.
test("surfaces external write history ahead of the publication status", () => {
  assert.equal(draftPublicationLabel(null), null);
  assert.equal(
    draftPublicationLabel({
      id: "p1",
      status: "NEEDS_REVIEW",
      externalWritePerformed: true,
    }),
    "게시 이력 있음",
  );
  assert.equal(
    draftPublicationLabel({
      id: "p1",
      status: "NEEDS_REVIEW",
      externalWritePerformed: false,
    }),
    "게시 시도 있음",
  );
  assert.equal(
    draftPublicationLabel({
      id: "p1",
      status: "PUBLISHING",
      externalWritePerformed: false,
    }),
    "게시 진행 중",
  );
});

test("points a refused deletion at the action that works", () => {
  const inProgress = deleteRejectionReason("PUBLICATION_IN_PROGRESS");
  const published = deleteRejectionReason("DRAFT_HAS_PUBLICATION");
  const unknown = deleteRejectionReason(undefined);

  assert.equal(inProgress.offersResume, true);
  assert.equal(published.offersResume, true);
  // Deleting and recreating is exactly what duplicates the Confluence page,
  // so the copy has to say so rather than just refusing.
  assert.ok(published.text.includes("중복"));
  assert.equal(unknown.offersResume, false);
});
