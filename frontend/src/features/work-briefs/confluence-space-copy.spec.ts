import assert from "node:assert/strict";
import test from "node:test";
import {
  spaceListNotice,
  spaceOptionLabel,
} from "./confluence-space-copy.ts";

test("always shows the key and says when the display name is missing", () => {
  assert.equal(
    spaceOptionLabel({
      spaceKey: "ENG",
      name: "엔지니어링",
      accessStatus: "accessible",
    }),
    "ENG · 엔지니어링",
  );
  assert.equal(
    spaceOptionLabel({
      spaceKey: "PAY",
      name: null,
      accessStatus: "access_limited",
    }),
    "PAY (표시명 확인 불가)",
  );
  assert.equal(
    spaceOptionLabel({
      spaceKey: "OPS",
      name: null,
      accessStatus: "not_requested",
    }),
    "OPS (표시명 미조회)",
  );
  assert.equal(
    spaceOptionLabel({
      spaceKey: "PAY",
      name: null,
      accessStatus: "unavailable",
    }),
    "PAY (표시명 확인 불가)",
  );
});

test("keeps the manual key field as the answer whenever the list is missing", () => {
  assert.match(String(spaceListNotice("loading", [])), /불러오는 중/);
  assert.match(String(spaceListNotice("unavailable", [])), /직접 입력/);
  assert.match(String(spaceListNotice("ready", [])), /허용된 Confluence space가 없습니다/);
  assert.equal(
    spaceListNotice("ready", [
      { spaceKey: "ENG", name: "엔지니어링", accessStatus: "accessible" },
    ]),
    null,
  );
});
