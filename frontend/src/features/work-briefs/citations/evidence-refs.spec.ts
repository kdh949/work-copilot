import assert from "node:assert/strict";
import test from "node:test";
import {
  citationChips,
  evidenceRefLabels,
  filterEvidence,
} from "./evidence-refs.ts";
import type { WorkEvidence } from "../work-briefs.types.ts";

const evidence = (
  id: string,
  overrides: Partial<WorkEvidence> = {},
): WorkEvidence => ({
  id,
  provider: "confluence",
  sourceId: id.toUpperCase(),
  url: `https://confluence.example.test/${id}`,
  title: `${id} 문서`,
  version: "1",
  excerptLength: 100,
  accessStatus: "accessible",
  dlpStatus: "not_evaluated",
  ...overrides,
});

test("numbers evidence by its position on screen", () => {
  const labels = evidenceRefLabels([
    evidence("a"),
    evidence("b"),
    evidence("c"),
  ]);

  assert.deepEqual([...labels], [
    ["a", "E1"],
    ["b", "E2"],
    ["c", "E3"],
  ]);
});

test("renumbers from scratch when the evidence array changes", () => {
  // What "근거 새로 고침" does: the same evidence, in a different order.
  const before = evidenceRefLabels([evidence("a"), evidence("b")]);
  const after = evidenceRefLabels([evidence("b"), evidence("a")]);

  assert.equal(before.get("a"), "E1");
  assert.equal(after.get("a"), "E2");
});

test("never gives one evidence id two numbers", () => {
  const labels = evidenceRefLabels([
    evidence("a"),
    evidence("a"),
    evidence("b"),
  ]);

  assert.equal(labels.get("a"), "E1");
  assert.equal(labels.get("b"), "E2");
  assert.equal(labels.size, 2);
});

test("searches the title, the provider and the source key", () => {
  const items = [
    evidence("a", { title: "결제 정책" }),
    evidence("b", { title: "배송 정책", provider: "jira", sourceId: "ENG-42" }),
  ];

  assert.deepEqual(
    filterEvidence(items, "결제").map((item) => item.id),
    ["a"],
  );
  assert.deepEqual(
    filterEvidence(items, "JIRA").map((item) => item.id),
    ["b"],
  );
  assert.deepEqual(
    filterEvidence(items, "eng-42").map((item) => item.id),
    ["b"],
  );
});

test("treats a blank query as no filter rather than no results", () => {
  const items = [evidence("a"), evidence("b")];

  assert.equal(filterEvidence(items, "   ").length, 2);
  assert.equal(filterEvidence(items, "").length, 2);
});

test("folds the chips past the limit into an overflow count", () => {
  const items = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) =>
    evidence(id),
  );

  const chips = citationChips(
    items.map((item) => item.id),
    items,
  );

  assert.deepEqual(
    chips.shown.map((chip) => chip.label),
    ["E1", "E2", "E3", "E4", "E5", "E6"],
  );
  assert.equal(chips.overflow, 2);
});

test("keeps an excluded chip visible instead of folding it away", () => {
  const items = [
    evidence("a"),
    evidence("b"),
    evidence("c"),
    evidence("d"),
    evidence("e"),
    evidence("f"),
    // Last on screen, so a positional fold would hide it behind "+1".
    evidence("g", { aiStatus: "excluded" }),
  ];

  const chips = citationChips(
    items.map((item) => item.id),
    items,
  );

  assert.deepEqual(chips.shown[0], { id: "g", label: "E7", excluded: true });
  assert.equal(chips.overflow, 1);
});

test("reports a linked id the evidence array no longer has", () => {
  const chips = citationChips(["a", "gone"], [evidence("a")]);

  assert.deepEqual(
    chips.shown.map((chip) => chip.id),
    ["a"],
  );
  assert.deepEqual(chips.unknown, ["gone"]);
});

test("shows no chips and no overflow when nothing is linked", () => {
  const chips = citationChips([], [evidence("a")]);

  assert.deepEqual(chips.shown, []);
  assert.equal(chips.overflow, 0);
  assert.deepEqual(chips.unknown, []);
});
