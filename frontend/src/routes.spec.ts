import assert from "node:assert/strict";
import test from "node:test";
import {
  BRIEFS_PREVIEW_PATH,
  MENU_PATHS,
  draftIdFromPathname,
  menuFromPathname,
} from "./routes.ts";

test("resolves every menu path to its screen", () => {
  for (const [menu, path] of Object.entries(MENU_PATHS)) {
    assert.equal(menuFromPathname(path), menu);
    assert.equal(menuFromPathname(`${path}/`), menu);
  }
});

test("resolves a draft path to the briefs screen", () => {
  assert.equal(
    menuFromPathname("/briefs/0e9a46da-cce1-4f35-a0ee-2488f8596391"),
    "workBriefs",
  );
  assert.equal(
    draftIdFromPathname("/briefs/0e9a46da-cce1-4f35-a0ee-2488f8596391"),
    "0e9a46da-cce1-4f35-a0ee-2488f8596391",
  );
  assert.equal(draftIdFromPathname(MENU_PATHS.workBriefs), null);
});

test("matches whole segments so a lookalike path is not a screen", () => {
  assert.equal(menuFromPathname("/briefsomething"), null);
  assert.equal(menuFromPathname("/wikipedia"), null);
  assert.equal(menuFromPathname("/"), null);
  assert.equal(menuFromPathname("/unknown"), null);
});

// The preview screen serves design fixtures. Resolving it here would expose it
// in a production build, where the development guard in App no longer applies.
test("never resolves the development preview path to a screen", () => {
  assert.equal(menuFromPathname(BRIEFS_PREVIEW_PATH), null);
});
