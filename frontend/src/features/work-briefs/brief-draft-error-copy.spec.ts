import assert from "node:assert/strict";
import test from "node:test";
import { createDraftFailureMessage } from "./brief-draft-error-copy.ts";

test("explains a duplicate draft without misdirecting the user to integrations", () => {
  const message = createDraftFailureMessage({
    status: 409,
    code: "DRAFT_ALREADY_EXISTS",
  });

  assert.ok(message.includes("이미 브리프 초안이 있습니다"));
  assert.ok(message.includes("다른 사용자"));
  assert.ok(!message.includes("연결 상태"));
});

test("keeps the connection guidance for other create failures", () => {
  const message = createDraftFailureMessage({
    status: 503,
    code: "PROVIDER_UNAVAILABLE",
  });

  assert.ok(message.includes("연결 상태"));
});
