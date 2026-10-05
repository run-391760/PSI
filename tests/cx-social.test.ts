import assert from "node:assert/strict";
import { test } from "node:test";

process.env.PGLITE_PATH ??= "memory://";
const wh = await import("../src/lib/cx/inbox/webhooks");
const li = await import("../src/lib/cx/inbox/linkedin");
const { messagingTag } = await import("../src/lib/cx/inbox/dispatch");

test("Instagram story mentions and story replies keep the story link", () => {
  const body = { object: "instagram", entry: [{ id: "IG1", messaging: [
    { sender: { id: "U1" }, recipient: { id: "IG1" }, timestamp: 1790000000000, message: { mid: "m1", attachments: [{ type: "story_mention", payload: { url: "https://cdn/story1" } }] } },
    { sender: { id: "U2" }, recipient: { id: "IG1" }, timestamp: 1790000000001, message: { mid: "m2", text: "so cool", reply_to: { story: { url: "https://cdn/story2", id: "s2" } } } },
  ] }] };
  const m = wh.mapMeta(body);
  assert.deepEqual(m.map((x) => x.text), ["Mentioned you in their story", "Replied to your story: so cool"]);
  assert.deepEqual(m[0].attachments, [{ type: "story", url: "https://cdn/story1" }]);
  assert.deepEqual(m[1].attachments, [{ type: "story", url: "https://cdn/story2" }]);
});

test("Facebook Page reviews become review threads; removals ignored", () => {
  const body = { object: "page", entry: [{ id: "P1", changes: [
    { field: "ratings", value: { item: "rating", verb: "add", reviewer_id: "U9", reviewer_name: "Asha", review_text: "Great campus", recommendation_type: "positive", open_graph_story_id: "OG1", created_time: 1790000000 } },
    { field: "ratings", value: { item: "rating", verb: "add", reviewer_id: "U8", reviewer_name: "Ravi", recommendation_type: "negative", open_graph_story_id: "OG2" } },
    { field: "ratings", value: { item: "rating", verb: "remove", open_graph_story_id: "OG1" } },
  ] }] };
  const r = wh.mapMetaChanges(body).items;
  assert.deepEqual(r.map((i) => [i.thread?.key, i.thread?.label, i.text, i.senderName]), [
    ["fbr:OG1", "Recommends your Page", "Great campus", "Asha"],
    ["fbr:OG2", "Doesn't recommend your Page", "[recommendation]", "Ravi"],
  ]);
  assert.deepEqual(wh.parseMetaThread("fbr:OG1"), { kind: "fbr", id: "OG1", commentId: null });
});

test("Meta messaging window: 24 h, 7 days with Human Agent, then closed", () => {
  assert.equal(messagingTag(null, false), "response");
  assert.equal(messagingTag(23.9, false), "response");
  assert.equal(messagingTag(25, false), "closed");
  assert.equal(messagingTag(25, true), "human_agent");
  assert.equal(messagingTag(24 * 7 + 1, true), "closed");
});

test("LinkedIn thread keys, comment ids and comment mapping", () => {
  const post = "urn:li:share:7100";
  const top = "urn:li:comment:(urn:li:activity:7100,111)";
  assert.deepEqual(li.parseLinkedInThread(`lic|${post}|${top}`), { kind: "lic", postUrn: post, commentUrn: top });
  assert.deepEqual(li.parseLinkedInThread(`lip|${post}`), { kind: "lip", postUrn: post });
  assert.equal(li.parseLinkedInThread("fbc:1"), null);
  assert.equal(li.commentIdOf(top), "111");
  const org = "urn:li:organization:42";
  const c = li.mapComment(org, post, { commentUrn: top, actor: "urn:li:person:abc", message: { text: "When is the fair?" }, created: { time: 1790000000000 } }, "https://www.linkedin.com/feed/update/x/");
  assert.equal(c?.thread?.key, `lic|${post}|${top}`);
  assert.equal(c?.senderName, "LinkedIn member");
  assert.equal(c?.timestamp, new Date(1790000000000).toISOString());
  const reply = li.mapComment(org, post, { commentUrn: "urn:li:comment:(urn:li:activity:7100,112)", parentComment: top, actor: "urn:li:person:def", message: { text: "+1" }, created: { time: 1 } }, null);
  assert.equal(reply?.thread?.key, `lic|${post}|${top}`);
  assert.equal(li.mapComment(org, post, { commentUrn: top, actor: org, message: { text: "ours" } }, null), null);
});
