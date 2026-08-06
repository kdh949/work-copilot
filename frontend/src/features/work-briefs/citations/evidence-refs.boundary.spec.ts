import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workBriefs = join(here, "..");

/**
 * Reference labels ("E1") are a rendering detail. This is the guard that keeps
 * them from becoming data: the modules that assemble what goes to the server
 * must not be able to reach the module that invents the numbers (R24).
 */
test("keeps reference labels out of the code that talks to the server", () => {
  const payloadModules = [
    "WorkBriefsPage.tsx",
    "draft-route-loader.ts",
    "assigned-issue-lookup.ts",
  ];

  for (const file of payloadModules) {
    const source = readFileSync(join(workBriefs, file), "utf8");
    assert.equal(
      /evidence-refs/.test(source),
      false,
      `${file} must not import citations/evidence-refs`,
    );
    assert.equal(
      /evidenceRefLabels|citationChips/.test(source),
      false,
      `${file} must not build reference labels`,
    );
  }
});

test("never writes a label into the draft content it sends", () => {
  // The saved shape is `BriefContent`, and the fixture is the closest thing to
  // a real one the frontend owns. A label reaching it would show up as a bare
  // "E<number>" string in the JSON.
  const preview = readFileSync(join(workBriefs, "work-briefs.preview.ts"), "utf8");
  const evidenceIdLiterals = preview.match(/evidenceIds: \[[^\]]*\]/g) ?? [];

  assert.ok(evidenceIdLiterals.length > 0);
  for (const literal of evidenceIdLiterals) {
    assert.equal(
      /"E\d+"/.test(literal),
      false,
      `evidenceIds must carry ids, not labels: ${literal}`,
    );
  }
});
