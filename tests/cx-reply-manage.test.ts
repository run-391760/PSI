import assert from "node:assert/strict";
import { test } from "node:test";
import { sentReplyActions } from "../src/lib/cx/inbox/model";

const sent = { direction: "out", delivery: "sent", delivery_error: null, external_id: "123_456", moderation: null };

test("sentReplyActions: Facebook public replies can be edited and deleted", () => {
  for (const key of ["fbc:111_222", "fbp:111_222", "fbr:999"]) assert.deepEqual(sentReplyActions(sent, "facebook", key), { edit: true, delete: true });
});

test("sentReplyActions: Instagram comment replies can only be deleted (Instagram has no comment editing)", () => {
  assert.deepEqual(sentReplyActions(sent, "instagram", "igc:178"), { edit: false, delete: true });
});

test("sentReplyActions: nothing for failed, stored, deleted, inbound, private or DM replies", () => {
  const none = { edit: false, delete: false };
  assert.deepEqual(sentReplyActions({ ...sent, delivery: "failed" }, "facebook", "fbc:1"), none);
  assert.deepEqual(sentReplyActions({ ...sent, delivery: "stored" }, "facebook", "fbc:1"), none);
  assert.deepEqual(sentReplyActions({ ...sent, external_id: null }, "facebook", "fbc:1"), none);
  assert.deepEqual(sentReplyActions({ ...sent, moderation: "deleted" }, "facebook", "fbc:1"), none);
  assert.deepEqual(sentReplyActions({ ...sent, direction: "in" }, "facebook", "fbc:1"), none);
  assert.deepEqual(sentReplyActions({ ...sent, delivery_error: "Sent as a private message to the commenter." }, "facebook", "fbc:1"), none);
  // Messenger / Instagram DMs (no public thread key) and Instagram @mentions elsewhere.
  assert.deepEqual(sentReplyActions(sent, "facebook", ""), none);
  assert.deepEqual(sentReplyActions(sent, "instagram", "igm:5"), none);
  assert.deepEqual(sentReplyActions(sent, "email", "fbc:1"), none);
});
