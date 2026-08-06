import assert from "node:assert/strict";
import test from "node:test";
import { citationAnchorId, evidenceRowId } from "./citation-anchors.ts";

test("makes an evidence id safe to use as a DOM id", () => {
  // Provider ids carry colons and slashes; both are legal in an id attribute
  // but not in the CSS selectors that read one back.
  assert.equal(evidenceRowId("jira:100"), "evidence-row-jira_100");
  assert.equal(
    evidenceRowId("confluence:SPACE/42"),
    "evidence-row-confluence_SPACE_42",
  );
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
