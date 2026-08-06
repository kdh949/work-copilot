import assert from "node:assert/strict";
import test from "node:test";
import { citationAnchorId, evidenceRowId } from "./citation-anchors.ts";

test("makes an evidence id safe to use as a DOM id", () => {
  assert.equal(evidenceRowId("jira:100"), "evidence-row-jira%3A100");
  assert.equal(
    evidenceRowId("confluence:SPACE/42"),
    "evidence-row-confluence%3ASPACE%2F42",
  );
});

test("never gives two different evidence ids the same DOM id", () => {
  // The pairs that a "replace unsafe characters with _" scheme collapses.
  // getElementById answers with the first match, so a collision sends a chip
  // to another evidence's row.
  const collidingPairs = [
    ["SPACE/42", "SPACE_42"],
    ["A:B", "A_B"],
    ["A B", "A_B"],
    ["%2F", "/"],
  ];

  for (const [left, right] of collidingPairs) {
    assert.notEqual(
      evidenceRowId(left),
      evidenceRowId(right),
      `${left} and ${right} must not share a row id`,
    );
  }
});

test("numbers a list section and leaves the single-item sections bare", () => {
  assert.equal(citationAnchorId("요구사항", 2), "citation-requirements-2");
  assert.equal(citationAnchorId("제목", 0), "citation-title");
});

test("has no anchor for a section it does not know", () => {
  // A new section added to BriefContent without a key here must fail visibly
  // as "no link" rather than by pointing at the wrong element.
  assert.equal(citationAnchorId("부록", 1), null);
});
