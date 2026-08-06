import assert from "node:assert/strict";
import test from "node:test";
import { popoverPosition, popoverSupported } from "./popover-position.ts";

const viewport = { width: 1000, height: 800 };
const panel = { width: 320, height: 240 };

test("sits under the trigger when there is room", () => {
  const position = popoverPosition(
    { top: 100, left: 200, width: 120, height: 32 },
    panel,
    viewport,
  );

  assert.deepEqual(position, { top: 140, left: 200, placement: "below" });
});

test("flips above the trigger when the panel would run off the bottom", () => {
  const position = popoverPosition(
    { top: 700, left: 200, width: 120, height: 32 },
    panel,
    viewport,
  );

  assert.equal(position.placement, "above");
  assert.equal(position.top, 700 - 240 - 8);
});

test("keeps a panel that grew after opening inside the bottom edge", () => {
  // The panel was 60px tall when it opened near the bottom; expanding the
  // excluded-evidence section made it 360px. Nothing fires scroll or resize
  // for that, so the position function has to answer with a clamp.
  const anchor = { top: 634, left: 200, width: 120, height: 32 };

  const small = popoverPosition(anchor, { width: 320, height: 60 }, viewport);
  const grown = popoverPosition(anchor, { width: 320, height: 360 }, viewport);

  assert.equal(small.top + 60 <= viewport.height, true);
  assert.equal(grown.top + 360 <= viewport.height, true);
});

test("stays inside the viewport when neither side fits", () => {
  const position = popoverPosition(
    { top: 90, left: 200, width: 120, height: 32 },
    { width: 320, height: 400 },
    { width: 1000, height: 300 },
  );

  // Clamped to the top edge rather than left hanging below the fold: the
  // panel scrolls internally, so its first row has to be the visible one.
  assert.equal(position.top, 8);
});

test("stays below when flipping would run off the top instead", () => {
  // A viewport too short for the panel in either direction: the flip would
  // only trade a bottom overflow for a top one.
  const position = popoverPosition(
    { top: 40, left: 200, width: 120, height: 32 },
    panel,
    { width: 1000, height: 200 },
  );

  assert.equal(position.placement, "below");
});

test("pulls the panel back inside the right edge", () => {
  const position = popoverPosition(
    { top: 100, left: 950, width: 40, height: 32 },
    panel,
    viewport,
  );

  assert.equal(position.left, 1000 - 320 - 8);
});

test("keeps the panel start reachable when it is wider than the viewport", () => {
  const position = popoverPosition(
    { top: 100, left: 40, width: 40, height: 32 },
    { width: 1200, height: 240 },
    viewport,
  );

  assert.equal(position.left, 8);
});

test("detects popover support from the element prototype", () => {
  assert.equal(popoverSupported({ popover: null }), true);
  assert.equal(popoverSupported({}), false);
  // Server rendering or a test runner without a DOM: not supported, not a crash.
  assert.equal(popoverSupported(undefined), false);
});
