import assert from "node:assert/strict";
import test from "node:test";
import { evidenceUsage, evidenceUsageSummary } from "./evidence-usage.ts";
import type { BriefContent, ChildTask } from "../work-briefs.types.ts";

const citation = (text: string, evidenceIds: string[]) => ({
  text,
  evidenceIds,
});

const childTask = (
  clientTaskId: string,
  evidenceIds: string[],
  selected = true,
): ChildTask => ({
  clientTaskId,
  summary: `${clientTaskId} 작업`,
  selected,
  text: `${clientTaskId} 작업`,
  evidenceIds,
});

const content = (overrides: Partial<BriefContent> = {}): BriefContent => ({
  title: citation("제목", []),
  summary: citation("요약", []),
  requirements: [],
  acceptanceCriteria: [],
  risks: [],
  nextSteps: [],
  childTasks: [],
  ...overrides,
});

test("collects every place an evidence id is cited", () => {
  const usage = evidenceUsage(
    content({
      title: citation("제목", ["a"]),
      requirements: [citation("요구 1", ["a"]), citation("요구 2", ["a", "b"])],
      acceptanceCriteria: [citation("기준 1", ["b"])],
    }),
  );

  assert.deepEqual(usage.get("a"), [
    { section: "제목", index: 0 },
    { section: "요구사항", index: 1 },
    { section: "요구사항", index: 2 },
  ]);
  assert.deepEqual(usage.get("b"), [
    { section: "요구사항", index: 2 },
    { section: "완료 기준", index: 1 },
  ]);
});

test("counts a child task whether or not it is selected for publishing", () => {
  const usage = evidenceUsage(
    content({
      childTasks: [childTask("t1", ["a"], false), childTask("t2", ["a"], true)],
    }),
  );

  assert.deepEqual(usage.get("a"), [
    { section: "하위 작업", index: 1 },
    { section: "하위 작업", index: 2 },
  ]);
});

test("counts a duplicated id within one item once", () => {
  const usage = evidenceUsage(
    content({ requirements: [citation("요구 1", ["a", "a"])] }),
  );

  assert.deepEqual(usage.get("a"), [{ section: "요구사항", index: 1 }]);
});

test("has no entry for evidence that nothing cites", () => {
  const usage = evidenceUsage(content({ requirements: [citation("요구", [])] }));

  assert.equal(usage.get("a"), undefined);
  assert.equal(evidenceUsageSummary(usage.get("a")), null);
});

test("answers an empty map for a draft with no content yet", () => {
  assert.equal(evidenceUsage(null).size, 0);
});

test("summarises usage as counts per section, not a list of every place", () => {
  const usage = evidenceUsage(
    content({
      requirements: [citation("요구 1", ["a"]), citation("요구 2", ["a"])],
      acceptanceCriteria: [citation("기준 1", ["a"])],
      childTasks: [childTask("t1", ["a"])],
    }),
  );

  assert.equal(
    evidenceUsageSummary(usage.get("a")),
    "요구사항 2 · 완료 기준 1 · 하위 작업 1",
  );
});
