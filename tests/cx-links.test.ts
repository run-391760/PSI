import assert from "node:assert/strict";
import { test } from "node:test";
import { appTicketLink, linkInBody, publicLink, ticketLink } from "../src/lib/cx/inbox/links";

const fbBody = "very excited🥳\n\nComment on your Page post: https://www.facebook.com/466642616726169_1482336660770993";

test("Facebook comment threads open at the comment on the Page post", () => {
  assert.equal(linkInBody(fbBody), "https://www.facebook.com/466642616726169_1482336660770993");
  assert.equal(publicLink({ threadKey: "fbc:1482336660770993_998877", firstBody: fbBody }), "https://www.facebook.com/466642616726169_1482336660770993?comment_id=998877");
  // A reply in the same thread links to that reply.
  assert.equal(publicLink({ threadKey: "fbc:1482336660770993_998877", firstBody: fbBody, commentId: "1482336660770993_112233" }), "https://www.facebook.com/466642616726169_1482336660770993?comment_id=112233");
  // Without the post link in the first message, the post id from the comment id.
  assert.equal(publicLink({ threadKey: "fbc:1482336660770993_998877" }), "https://www.facebook.com/1482336660770993?comment_id=998877");
});

test("posts, reviews, Instagram, LinkedIn and mentions", () => {
  assert.equal(publicLink({ threadKey: "fbp:466642616726169_555" }), "https://www.facebook.com/466642616726169_555");
  assert.equal(publicLink({ threadKey: "fbr:777" }), "https://www.facebook.com/777");
  assert.equal(publicLink({ threadKey: "igc:179", firstBody: "nice\n\nComment on your post: https://www.instagram.com/p/AbC/" }), "https://www.instagram.com/p/AbC/");
  assert.equal(publicLink({ threadKey: "igc:179", firstBody: "nice" }), null, "no permalink: no guess");
  assert.equal(publicLink({ threadKey: "lic|urn:li:activity:42|urn:li:comment:(urn:li:activity:42,7)" }), "https://www.linkedin.com/feed/update/urn:li:activity:42/");
  assert.equal(publicLink({ threadKey: "fbc:1_2", mentionUrl: "https://news.example/a" }), "https://news.example/a", "the mention URL wins");
});

test("DMs, email and chat link to the ticket in the app", () => {
  assert.equal(publicLink({ threadKey: null, firstBody: "Hi, my fees question" }), null);
  assert.equal(appTicketLink("t1", "b 1", "https://ns.example/"), "https://ns.example/cx/ticket/t1?brand=b%201");
  assert.match(ticketLink({ threadKey: null, ticketId: "t1", brand: "b1" }), /\/cx\/ticket\/t1\?brand=b1$/);
});
