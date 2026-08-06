import assert from "node:assert/strict";
import test from "node:test";
import {
  connectionsNeedingAction,
  toConnectionSnapshot,
} from "./connection-snapshot.ts";
import type { IntegrationConnection } from "../integrations/connection-status.ts";

test("treats a missing provider as never authorized, not as connected", () => {
  const snapshot = toConnectionSnapshot([
    { provider: "jira", status: "connected" },
  ]);

  assert.deepEqual(snapshot, {
    state: "ready",
    byProvider: { jira: "connected", confluence: "authorization_required" },
  });
});

test("reports an unusable response as unavailable rather than as no connections", () => {
  // A failed read and "nothing is connected" lead to different screens; a
  // non-array body must not be read as the second.
  const snapshot = toConnectionSnapshot(
    null as unknown as IntegrationConnection[],
  );

  assert.deepEqual(snapshot, { state: "unavailable" });
});

test("lists only the providers that still need the user to act", () => {
  const snapshot = toConnectionSnapshot([
    { provider: "jira", status: "connected" },
    { provider: "confluence", status: "expired" },
  ]);

  assert.deepEqual(connectionsNeedingAction(snapshot), ["confluence"]);
});

test("asks for nothing while the connection state is still unknown", () => {
  // Prompting during loading, or after a failed read, would tell the user to
  // fix something that may not be broken.
  assert.deepEqual(connectionsNeedingAction({ state: "loading" }), []);
  assert.deepEqual(connectionsNeedingAction({ state: "unavailable" }), []);
});
