import assert from "node:assert/strict";
import test from "node:test";
import {
  canRegenerateDraft,
  canUndoRegeneration,
  emptySectionNotice,
  excludedEvidenceReason,
  isLegacyBriefContent,
  regenerateFailureMessage,
} from "./brief-regeneration-copy.ts";
import type { BriefContent, BriefDraft } from "./work-briefs.types.ts";

const citation = (evidenceIds: string[]) => ({ text: "본문", evidenceIds });

const content = (overrides: Partial<BriefContent> = {}): BriefContent => ({
  title: citation(["jira:1"]),
  summary: citation(["jira:1"]),
  requirements: [citation(["jira:1"])],
  acceptanceCriteria: [citation(["jira:2"])],
  risks: [citation(["jira:2"])],
  nextSteps: [citation(["jira:1"])],
  childTasks: [
    {
      ...citation(["jira:2"]),
      clientTaskId: "8a8c0e4a-0000-4000-8000-000000000001",
      summary: "하위 작업",
      selected: false,
    },
  ],
  ...overrides,
});

const legacyContent = content({
  title: citation(["jira:1", "jira:2"]),
  summary: citation(["jira:1", "jira:2"]),
  requirements: [citation(["jira:1", "jira:2"])],
  risks: [citation(["jira:1", "jira:2"])],
  nextSteps: [citation(["jira:1", "jira:2"])],
  acceptanceCriteria: [],
  childTasks: [],
});

const evidence = [{ id: "jira:1" }, { id: "jira:2" }];

test("points a refused regeneration at the action that works", () => {
  assert.match(
    regenerateFailureMessage({ status: 409, code: "SOURCE_REVIEW_REQUIRED" }),
    /근거를 새로 고쳐/,
  );
  assert.match(
    regenerateFailureMessage({ status: 409, code: "DRAFT_VERSION_CONFLICT" }),
    /최신 초안/,
  );
  assert.match(
    regenerateFailureMessage({ status: 409, code: "PUBLICATION_IN_PROGRESS" }),
    /게시가 진행 중/,
  );
  assert.match(
    regenerateFailureMessage({ status: 409, code: "DRAFT_HAS_PUBLICATION" }),
    /외부에 게시된/,
  );
  assert.match(regenerateFailureMessage({ status: 503 }), /연결 상태/);
});

test("requires a current draft that is not already busy", () => {
  const draft = { freshnessStatus: "current" } as BriefDraft;

  assert.equal(canRegenerateDraft(draft, false), true);
  assert.equal(canRegenerateDraft(draft, true), false);
  assert.equal(canRegenerateDraft(null, false), false);
  assert.equal(
    canRegenerateDraft(
      { freshnessStatus: "review_required" } as BriefDraft,
      false,
    ),
    false,
  );
});

test("does not offer a client-only undo after regeneration changes evidence", () => {
  assert.equal(
    canUndoRegeneration(
      [{ id: "jira:A" }, { id: "jira:B" }],
      [{ id: "jira:B" }],
    ),
    false,
  );
  assert.equal(
    canUndoRegeneration(
      [{ id: "jira:A" }, { id: "jira:B" }],
      [{ id: "jira:B" }, { id: "jira:A" }],
    ),
    true,
  );
});

test("shows the model reason for excluded evidence and never invents one", () => {
  assert.equal(
    excludedEvidenceReason({ aiExclusionReason: "요구사항과 무관합니다." }),
    "요구사항과 무관합니다.",
  );
  assert.match(excludedEvidenceReason({}), /기록되지 않았습니다/);
});

test("recognises a schema v1 draft only when every item cites everything", () => {
  assert.equal(isLegacyBriefContent(legacyContent, evidence), true);
  assert.equal(isLegacyBriefContent(content(), evidence), false);
  // One evidence item makes the two cases indistinguishable.
  assert.equal(
    isLegacyBriefContent(
      content({ acceptanceCriteria: [], childTasks: [] }),
      [{ id: "jira:1" }],
    ),
    false,
  );
});

test("separates 'not generated yet' from 'the evidence did not support it'", () => {
  assert.equal(emptySectionNotice("acceptanceCriteria", content(), evidence), null);

  const legacy = emptySectionNotice("acceptanceCriteria", legacyContent, evidence);
  assert.match(String(legacy), /이전 버전/);
  assert.match(String(legacy), /다시 생성/);

  const unsupported = emptySectionNotice(
    "childTasks",
    content({ childTasks: [] }),
    evidence,
  );
  assert.match(String(unsupported), /근거가 부족해/);
  assert.ok(!String(unsupported).includes("이전 버전"));
});
