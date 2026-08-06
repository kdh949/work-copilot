import assert from "node:assert/strict";
import test from "node:test";
import {
  loadConfluenceSpaces,
  shouldLoadConfluenceSpaces,
} from "./confluence-space-loading.ts";
import type { WorkBriefApiRequest } from "./work-briefs.types.ts";

test("does not load spaces on a draft detail route", () => {
  assert.equal(shouldLoadConfluenceSpaces("draft-1", true, false), false);
});

test("loads spaces once when source options first open and reuses the result", () => {
  assert.equal(shouldLoadConfluenceSpaces(undefined, false, false), false);
  assert.equal(shouldLoadConfluenceSpaces(undefined, true, false), true);
  assert.equal(shouldLoadConfluenceSpaces(undefined, true, true), false);
});

test("uses the provider route and refreshes connection status", async () => {
  const requestedPaths: string[] = [];
  let refreshCount = 0;
  const request: WorkBriefApiRequest = async <T>(path: string): Promise<T> => {
    requestedPaths.push(path);
    return {
      spaces: [
        { spaceKey: "ENG", name: "엔지니어링", accessStatus: "accessible" },
      ],
    } as T;
  };

  const result = await loadConfluenceSpaces(request, async () => {
    refreshCount += 1;
  });
  await Promise.resolve();

  assert.equal(result.spaces[0]?.spaceKey, "ENG");
  assert.deepEqual(requestedPaths, ["/work-items/confluence/spaces"]);
  assert.equal(refreshCount, 1);
});
