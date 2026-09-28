import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateRawSync, deflateRawSync } from "node:zlib";

const core = await import("../src/lib/cx/publishing/core");
const opt = await import("../src/lib/cx/publishing/options");
const sug = await import("../src/lib/cx/publishing/suggest");
const xl = await import("../src/lib/cx/publishing/xlsx");
const ad = await import("../src/lib/cx/publishing/adapters");

const creds = { externalId: "1234567890", token: "TOKEN" };
const base = { text: "Hello", firstComment: "", link: null, media: [] as any[] };

test("multi-approver: all designated approvers must approve; any rejection blocks", () => {
  const s0 = opt.approvalState(["a", "b"], []);
  assert.equal(s0.complete, false);
  assert.deepEqual(s0.waiting, ["a", "b"]);
  const s1 = opt.approvalState(["a", "b"], [{ user_id: "a", decision: "approved" }]);
  assert.deepEqual(s1.waiting, ["b"]);
  assert.equal(s1.complete, false);
  assert.equal(opt.approvalState(["a", "b"], [{ user_id: "a", decision: "approved" }, { user_id: "b", decision: "approved" }]).complete, true);
  assert.equal(opt.approvalState(["a", "b"], [{ user_id: "a", decision: "approved" }, { user_id: "b", decision: "rejected" }]).complete, false);
  // outsiders' approvals do not count in "all" mode
  assert.deepEqual(opt.approvalState(["a"], [{ user_id: "z", decision: "approved" }]).approved, []);
  // no designated approvers: first approval is enough
  assert.equal(opt.approvalState([], [{ user_id: "z", decision: "approved" }]).complete, true);
  // latest decision per user wins
  assert.equal(opt.approvalState(["a"], [{ user_id: "a", decision: "rejected" }, { user_id: "a", decision: "approved" }]).complete, true);
  assert.equal(opt.canDecide("x", ["a"], true), false);
  assert.equal(opt.canDecide("a", ["a"], false), true);
  assert.equal(opt.canDecide("x", [], true), true);
});

test("content-tag permissions", () => {
  assert.deepEqual(opt.tagCheck(["Launch"], [], ["launch"], "authors", false), { ok: true, tags: ["launch"], created: [] });
  const created = opt.tagCheck(["new-tag"], [], ["launch"], "authors", false);
  assert.equal(created.ok, false);
  assert.equal(opt.tagCheck(["launch"], [], ["launch"], "managers", false).ok, false);
  assert.equal(opt.tagCheck(["launch"], ["launch"], ["launch"], "managers", false).ok, true); // unchanged is fine
  const m = opt.tagCheck(["#Brand Voice", "launch"], [], ["launch"], "managers", true);
  assert.ok(m.ok && m.created[0] === "brand-voice");
});

test("post types, options cleaning and validation", () => {
  assert.equal(opt.typeSupport("poll", "x"), "api");
  assert.equal(opt.typeSupport("poll", "facebook"), "none");
  assert.equal(opt.typeSupport("event", "linkedin"), "manual");
  assert.deepEqual(opt.channelsForType("document"), ["linkedin"]);
  const o = opt.cleanOptions(
    { common: { poll_options: "Yes\nNo\n", poll_hours: "72" }, x: { reply_settings: "following", bogus: 1 }, facebook: { target_countries: ["US"] }, youtube: { privacy: "secret" } },
    ["x", "youtube"],
    "poll",
  );
  assert.deepEqual(o, { common: { poll_options: ["Yes", "No"], poll_hours: "72" }, x: { reply_settings: "following" } });
  assert.deepEqual(opt.typeProblems("poll", "x", { common: { poll_options: ["Only one"] } }, []), ["Polls need 2–4 options."]);
  assert.match(opt.typeProblems("poll", "x", { common: { poll_options: ["a", "b"] } }, [{ kind: "image" }]).join(), /cannot include media/);
  assert.match(opt.typeProblems("reel", "instagram", {}, [{ kind: "image" }]).join(), /exactly one video/);
  assert.match(opt.typeProblems("event", "gbp", { gbp: { event_title: "Sale", start_date: "2026-10-10", end_date: "2026-10-01" } }, []).join(), /end date/);
  assert.match(opt.typeProblems("story", "x", {}, []).join(), /does not support/);
  assert.deepEqual(opt.manualSteps("text", ["x"], { x: { super_followers: true } }), ["X: Super Followers only"]);
});

test("adapter request builders carry per-network options", () => {
  const fb = ad.facebookFeedRequest(creds, { ...base, options: { target_countries: ["us", "in"], target_age_min: "18" } });
  assert.deepEqual(fb.body!.targeting, { geo_locations: { countries: ["US", "IN"] }, age_min: 18 });
  const tw = ad.xTweetRequest(creds, "Which?", { poll: { options: ["A", "B"], hours: 24 }, mediaIds: ["1"], replySettings: "following" });
  assert.deepEqual(tw.body!.poll, { options: ["A", "B"], duration_minutes: 1440 });
  assert.equal(tw.body!.media, undefined);
  assert.equal(tw.body!.reply_settings, "following");
  const li = ad.linkedinPostRequest(creds, { ...base, postType: "poll", common: { poll_options: ["A", "B"], poll_hours: "168" }, options: { target_geo: ["urn:li:geo:1"], disable_reshare: true } });
  assert.equal((li.body!.content as any).poll.settings.duration, "SEVEN_DAYS");
  assert.deepEqual((li.body!.distribution as any).targetEntities, [{ geoLocations: ["urn:li:geo:1"] }]);
  assert.equal(li.body!.isReshareDisabledByAuthor, true);
  const doc = ad.linkedinPostRequest(creds, { ...base, postType: "document" }, [], { urn: "urn:li:document:9", title: "Deck" });
  assert.deepEqual(doc.body!.content, { media: { id: "urn:li:document:9", title: "Deck" } });
  const ig = ad.instagramContainerRequest(creds, { url: "https://x/v.mp4", kind: "video" }, "cap", { coverUrl: "https://x/c.jpg", shareToFeed: true, collaborators: ["a", "b", "c", "d"] });
  assert.equal(ig.body!.media_type, "REELS");
  assert.equal(ig.body!.cover_url, "https://x/c.jpg");
  assert.deepEqual(ig.body!.collaborators, ["a", "b", "c"]);
  const story = ad.instagramContainerRequest(creds, { url: "https://x/i.jpg", kind: "image" }, "cap", { story: true });
  assert.equal(story.body!.media_type, "STORIES");
  assert.equal(story.body!.caption, undefined);
  const th = ad.threadsContainerRequest(creds, { ...base, postType: "poll", common: { poll_options: ["A", "B", "C"] }, options: { ghost_post: true, reply_control: "mentioned_only" } });
  assert.deepEqual(th.body!.poll_attachment, { option_a: "A", option_b: "B", option_c: "C" });
  assert.equal(th.body!.is_ghost_post, true);
  const gbp = ad.gbpLocalPostRequest({ externalId: "accounts/1/locations/2", token: "T" }, { ...base, link: "https://e.com", postType: "event", options: { event_title: "Sale", start_date: "2026-10-01", end_date: "2026-10-05", offer: true, coupon_code: "SAVE10" } });
  assert.equal(gbp.url, "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts");
  assert.equal(gbp.body!.topicType, "OFFER");
  assert.deepEqual((gbp.body!.event as any).schedule.startDate, { year: 2026, month: 10, day: 1 });
  assert.deepEqual(gbp.body!.offer, { couponCode: "SAVE10" });
  const yt = ad.youtubeMetadata({ ...base, text: "My video\nmore", options: { privacy: "unlisted", category: "27" } });
  assert.deepEqual(yt, { snippet: { title: "My video", description: "My video\nmore", categoryId: "27" }, status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false } });
  assert.equal(ad.deleteRequest("x", creds, "55")!.url, "https://api.x.com/2/tweets/55");
  assert.equal(ad.deleteRequest("linkedin", creds, "urn:li:share:1")!.url, "https://api.linkedin.com/rest/posts/urn%3Ali%3Ashare%3A1");
  assert.equal(ad.deleteRequest("instagram", creds, "1"), null);
  assert.equal(ad.mapOpenAiImage({ data: [{ b64_json: Buffer.from("png").toString("base64") }] })!.toString(), "png");
  assert.equal(ad.mapOpenAiImage({ data: [] }), null);
});

test("best time to post from activity buckets", () => {
  // 30 clicks on Tuesdays 14:00 UTC, 10 on Fridays 09:00 UTC
  const ev = [...Array(30).fill("2026-09-15T14:10:00Z"), ...Array(10).fill("2026-09-18T09:30:00Z")].map((at) => ({ at }));
  const b = sug.bucketUtc(ev);
  assert.equal(b[2 * 24 + 14], 30);
  const slots = sug.topSlots(b, 2)!;
  assert.deepEqual(slots.map((s) => [s.day, s.hour]), [[2, 14], [5, 9]]);
  assert.equal(sug.topSlots(sug.bucketUtc(ev.slice(0, 5))), null); // too little data
  // IST (UTC+5:30 → offset −330) shifts 14:00 UTC to 19:00/20:00 local (rounded to 20)
  const local = sug.localBuckets(b, -330);
  assert.equal(local[2 * 24 + 20], 30);
  // Sunday 23:00 UTC in UTC+2 wraps to Monday 01:00
  const wrap = sug.localBuckets(sug.bucketUtc([{ at: "2026-09-20T23:00:00Z" }]), -120);
  assert.equal(wrap[1 * 24 + 1], 1);
  const next = sug.nextOccurrence({ day: 2, hour: 14 }, new Date(2026, 8, 28, 10, 0)); // Monday 28 Sep 2026
  assert.equal(next, "2026-09-29T14:00");
});

test("hashtag suggestions from listening and past posts", () => {
  const mentions = [
    "Loving the #AutumnSale from @brand",
    "#autumnsale deals are great, check the sustainability report",
    "Their sustainability report is out",
    "Sustainability matters #green",
  ];
  const posts = [{ text: "Launch day #ProductLaunch", clicks: 15 }, { text: "Old #autumnsale", clicks: 0 }];
  const s = sug.hashtagSuggestions({ mentions, posts, draft: "Our sustainability report #green", brand: "Brand" });
  const tags = s.map((x) => x.tag);
  assert.ok(tags.includes("autumnsale"));
  assert.ok(tags.includes("sustainability"));
  assert.ok(tags.includes("productlaunch"));
  assert.ok(!tags.includes("green")); // already in the draft
  assert.ok(!tags.includes("brand"));
  assert.equal(s.find((x) => x.tag === "sustainability")!.source, "listening terms");
  assert.equal(s.find((x) => x.tag === "sustainability")!.score, 6); // 3 mentions, doubled by draft relevance
  assert.equal(tags[0], "productlaunch"); // clicks weigh past-post hashtags
  assert.deepEqual(sug.hashtagsIn("a#b #ok & #x1 https://e.com/#frag"), ["ok", "x1"]);
});

test("image crop math and output sizes", () => {
  assert.deepEqual(sug.cropRect(4000, 3000, 1), { x: 500, y: 0, w: 3000, h: 3000 });
  assert.deepEqual(sug.cropRect(4000, 3000, 9 / 16, 1, 0, 0.5), { x: 0, y: 0, w: 1688, h: 3000 });
  assert.deepEqual(sug.cropRect(1000, 1000, 1, 2, 1, 1), { x: 500, y: 500, w: 500, h: 500 });
  assert.deepEqual(sug.outputSize({ w: 3000, h: 3000 }, { w: 1080, h: 1080 }), { w: 1080, h: 1080, upscaled: false });
  assert.equal(sug.outputSize({ w: 400, h: 400 }, { w: 1080, h: 1080 }).upscaled, true);
  assert.deepEqual(sug.outputSize({ w: 4096, h: 2048 }, null), { w: 2048, h: 1024, upscaled: false });
});

test("xlsx writer/reader round trip, deflated entries, Excel date serials, bulk parsing", () => {
  const rows = [core.BULK_COLUMNS, ["2030-10-05", "09:30", "x|linkedin", 'Tom & "Jerry" <3 {link}', "https://e.com", "Launch", "", "", "poll", "launch|promo"]];
  const bytes = xl.writeXlsx([{ name: "Posts", rows }, { name: "Guide", rows: [["Column", "Meaning"]] }]);
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.deepEqual(xl.readXlsx(bytes, (b) => new Uint8Array(inflateRawSync(b))), rows);
  assert.equal(xl.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);

  // An Excel-style workbook: deflated, shared strings, numeric date/time serials.
  const enc = new TextEncoder();
  const sheet = `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row r="2"><c r="A2" s="1"><v>47031</v></c><c r="B2"><v>0.75</v></c><c r="C2" t="s"><v>4</v></c><c r="D2" t="inlineStr"><is><t>Hi &amp; bye</t></is></c></row></sheetData></worksheet>`;
  const ss = `<sst><si><t>date</t></si><si><t>time</t></si><si><t>channels</t></si><si><r><t>te</t></r><r><t>xt</t></r></si><si><t>facebook</t></si></sst>`;
  const zip = xl.zipStore([
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheet) },
    { name: "xl/sharedStrings.xml", data: enc.encode(ss) },
  ]);
  // re-pack as deflated to exercise the inflate path
  const deflated = repackDeflated(zip);
  const table = xl.readXlsx(deflated, (b) => new Uint8Array(inflateRawSync(b)));
  assert.deepEqual(table, [["date", "time", "channels", "text"], ["47031", "0.75", "facebook", "Hi & bye"]]);
  assert.deepEqual(core.excelSerial("47031"), { date: "2028-10-05", time: "00:00" });
  const parsed = core.parseBulkTable(table, 0, new Date("2026-09-28T00:00:00Z"));
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows[0].at, "2028-10-05T18:00:00.000Z");
  assert.equal(parsed.rows[0].postType, "text");
  const bad = core.parseBulkCsv("date,time,channels,text,post_type\n2030-01-01,09:00,x,hi,carousel\n", 0);
  assert.match(bad.errors[0].error, /Unknown post type/);
  const poll = core.parseBulkCsv("date,time,channels,text,post_type,poll_options\n2030-01-01,09:00,x,Which?,poll, Dark mode | Exports \n", 0);
  assert.deepEqual(poll.rows[0].pollOptions, ["Dark mode", "Exports"]);
  assert.deepEqual(core.parseBulkCsv(core.BULK_TEMPLATE, 0, new Date("2026-09-28T00:00:00Z")).rows.map((r) => r.pollOptions.length), [0, 0, 2]);
  assert.throws(() => xl.readXlsx(new Uint8Array([1, 2, 3]), (b) => b), /Not an .xlsx/);
});

/** Rebuild a stored ZIP with deflate (method 8) entries. */
function repackDeflated(stored: Uint8Array): Uint8Array {
  const files = xl.unzip(stored, (b) => b);
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const comp = deflateRawSync(data);
    const n = Buffer.from(name);
    const crc = xl.crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(comp.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(n.length, 26);
    parts.push(h, n, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(files.size, 8);
  e.writeUInt16LE(files.size, 10);
  e.writeUInt32LE(cd.length, 12);
  e.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, e]));
}
