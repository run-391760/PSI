import assert from "node:assert/strict";
import { test } from "node:test";
import { extractBlocks, MAX_BLOCKS } from "../src/lib/optimizer/crawl/blocks";
import { GateStopped, HostGate, limiter } from "../src/lib/optimizer/crawl/gate";
import { GENERIC_ANCHOR, inspectPage, linkFlags, touchFor, type PageFactsLite } from "../src/lib/optimizer/crawl/rules";
import { clampPages, CrawlQueue, inScope, looksLikePage, normalizeStartUrl, normalizeUrl, registrableDomain } from "../src/lib/optimizer/crawl/scope";
import { inferKeyword, scorePage } from "../src/lib/optimizer/crawl/score";
import { encodeEvent, sseParser } from "../src/lib/optimizer/crawl/sse";
import { summarizeCrawl } from "../src/lib/optimizer/crawl/summary";
import type { CrawlEvent, PageResult } from "../src/lib/optimizer/crawl/types";

const URL_ = "https://www.example.com/blog/mba-admission-process";

const FIXTURE = `<!doctype html><html><head>
<title>MBA</title>
<link rel="canonical" href="https://www.example.com/blog/other-page">
<meta name="robots" content="noindex, follow">
</head><body>
<header class="site"><nav><a href="/">Home</a><a href="/a">A</a></nav></header>
<main>
<h1>MBA Admission Process</h1>
<p>Read the <a href="/blog/eligibility">eligibility rules</a> first, then <a href="https://other.org/x">click here</a> for dates.</p>
<h3>Skipped a level</h3>
<h1>Second H1</h1>
<img src="http://www.example.com/img/campus.jpg">
<img src="/img/logo.png" alt="">
<img src="/img/students.jpg" alt="Students in class">
<ul><li>First item with <a href="http://www.example.com/insecure">an insecure link</a></li><li>Second <a href="/empty"><span></span></a></li></ul>
<p>${"word ".repeat(160)}</p>
<table><caption>Fees</caption><tr><th>Year</th><th>Fee</th></tr><tr><td>1</td><td>2,00,000</td></tr></table>
<h2></h2>
</main>
<footer><a href="/privacy">Privacy</a></footer>
<script>var x = "<p>not text</p>";</script>
</body></html>`;

const facts = (over: Partial<PageFactsLite> = {}): PageFactsLite => ({
  url: URL_,
  status: 200,
  title: "MBA",
  metaDescription: "",
  lang: null,
  viewport: false,
  noindex: true,
  robots: "noindex, follow",
  canonical: "https://www.example.com/blog/other-page",
  h1Count: 2,
  words: 200,
  ttfbMs: 2400,
  ...over,
});

test("block extraction: head blocks, document order, inline links, images, tables, no chrome", () => {
  const blocks = extractBlocks(FIXTURE, URL_);
  assert.deepEqual(
    blocks.slice(0, 3).map((b) => b.tag),
    ["title", "meta", "head"],
  );
  assert.equal(blocks[0].text, "MBA");
  assert.match(blocks[2].text, /lang=missing/);
  assert.match(blocks[2].text, /robots: noindex, follow/);
  const tags = blocks.slice(3).map((b) => b.tag);
  assert.equal(tags[0], "h1");
  // Nav/footer links and script text never appear.
  assert.ok(!blocks.some((b) => b.href?.endsWith("/privacy") || b.href === "https://www.example.com/a"));
  assert.ok(!blocks.some((b) => /not text/.test(b.text)));
  const p = blocks.find((b) => b.tag === "p" && b.segs)!;
  assert.equal(p.text, "Read the eligibility rules first, then click here for dates.");
  const linkIds = p.segs!.filter((s) => s.a).map((s) => s.a);
  assert.equal(linkIds.length, 2);
  const links = blocks.filter((b) => b.parent === p.id);
  assert.deepEqual(
    links.map((l) => [l.text, l.href]),
    [
      ["eligibility rules", "https://www.example.com/blog/eligibility"],
      ["click here", "https://other.org/x"],
    ],
  );
  const h3 = blocks.find((b) => b.text === "Skipped a level")!;
  assert.equal(h3.tag, "h3");
  assert.equal(h3.level, 3);
  const imgs = blocks.filter((b) => b.tag === "img");
  assert.deepEqual(
    imgs.map((i) => i.alt),
    [null, "", "Students in class"],
  );
  assert.equal(imgs[1].src, "https://www.example.com/img/logo.png");
  const table = blocks.find((b) => b.tag === "table")!;
  assert.equal(table.text, "Fees");
  assert.deepEqual(table.rows, [
    ["Year", "Fee"],
    ["1", "2,00,000"],
  ]);
  const long = blocks.find((b) => b.tag === "p" && (b.words ?? 0) > 150)!;
  assert.equal(long.words, 160);
  assert.ok(long.text.length <= 280 && long.text.endsWith("…"));
  assert.ok(blocks.some((b) => b.tag === "h2" && b.text === ""));
  const li = blocks.filter((b) => b.tag === "li");
  assert.equal(li.length, 2);
  // Ids are unique.
  assert.equal(new Set(blocks.map((b) => b.id)).size, blocks.length);
});

test("block extraction: inline-text containers, figures, and long link-only lists", () => {
  const html = `<html><body><main>
<div class="hatnote">For the search engine, see <a href="/wiki/WebCrawler">WebCrawler</a>.</div>
<figure><a href="/wiki/File:x.png"><img src="/x.png" alt=""></a><figcaption>Architecture of a crawler</figcaption></figure>
<ul class="langs">${Array.from({ length: 30 }, (_, i) => `<li><a href="/l${i}">Lang ${i}</a></li>`).join("")}</ul>
<div class="vector-dropdown"><a href="/menu">Menu item</a></div>
<p>${"text ".repeat(130)}</p>
</main></body></html>`;
  const blocks = extractBlocks(html, "https://en.example.org/wiki/Crawler");
  const note = blocks.find((b) => b.text.startsWith("For the search engine"))!;
  assert.equal(note.tag, "p");
  assert.equal(blocks.find((b) => b.parent === note.id)?.text, "WebCrawler");
  const imgLink = blocks.find((b) => b.tag === "a" && b.href?.endsWith("File:x.png"))!;
  assert.equal(imgLink.text, "");
  assert.equal(imgLink.parent, undefined);
  assert.ok(blocks.some((b) => b.text === "Architecture of a crawler"));
  const langs = blocks.filter((b) => b.tag === "li");
  assert.equal(langs.length, 7);
  assert.equal(langs[6].text, "… 24 more links in this list");
  assert.ok(!blocks.some((b) => b.text === "Menu item"));
});

test("block extraction is capped", () => {
  const html = `<html><body><main>${Array.from({ length: 200 }, (_, i) => `<p>Paragraph ${i} <a href="/p${i}">link ${i}</a></p>`).join("")}</main></body></html>`;
  const blocks = extractBlocks(html, "https://example.com/");
  assert.ok(blocks.length <= MAX_BLOCKS);
  assert.ok(blocks.filter((b) => b.tag === "a").length <= 40);
});

test("flag rules on the fixture are the measured issues", () => {
  const blocks = extractBlocks(FIXTURE, URL_);
  const flags = inspectPage(facts(), blocks);
  const rules = new Set(flags.map((f) => f.rule));
  for (const r of ["title-length", "meta-missing", "noindex", "canonical-other", "lang-missing", "viewport-missing", "slow-response", "h1-multiple", "heading-skip", "heading-empty", "thin-content", "long-paragraph", "img-alt-missing", "img-alt-empty", "img-mixed", "anchor-generic", "anchor-empty", "link-insecure"])
    assert.ok(rules.has(r as never), `expected ${r}`);
  assert.ok(!rules.has("title-missing"));
  assert.ok(!rules.has("h1-missing"));
  // Element flags point at the element.
  const generic = flags.find((f) => f.rule === "anchor-generic")!;
  assert.equal(blocks.find((b) => b.id === generic.blockId)?.text, "click here");
  const second = flags.find((f) => f.rule === "h1-multiple")!;
  assert.equal(blocks.find((b) => b.id === second.blockId)?.text, "Second H1");
  const skip = flags.find((f) => f.rule === "heading-skip" && /H1 → H3/.test(f.label));
  assert.ok(skip);
  // Clean page: no flags.
  const clean = inspectPage(facts({ title: "MBA Admission Process 2026: Eligibility and Steps", metaDescription: "x".repeat(140), lang: "en", viewport: true, noindex: false, robots: "", canonical: URL_, h1Count: 1, words: 900, ttfbMs: 200 }), [
    { id: "b0", tag: "title", text: "t" },
    { id: "b3", tag: "h1", level: 1, text: "MBA" },
    { id: "b4", tag: "h2", level: 2, text: "Eligibility" },
    { id: "b5", tag: "p", text: "Some text", words: 80 },
    { id: "b6", tag: "img", text: "Campus", alt: "Campus", src: "https://www.example.com/c.jpg" },
    { id: "b7", tag: "a", text: "MBA fees 2026", href: "https://www.example.com/fees", parent: "b5" },
  ]);
  assert.deepEqual(clean, []);
  // Canonical with only a trailing-slash difference is labelled as such.
  const slash = inspectPage(facts({ canonical: `${URL_}/` }), []).find((f) => f.rule === "canonical-other")!;
  assert.match(slash.label, /trailing slash/);
});

test("generic anchors", () => {
  for (const t of ["click here", "Read more", "here", "Learn More", "more"]) assert.ok(GENERIC_ANCHOR.test(t), t);
  for (const t of ["MBA fees", "read more about fees"]) assert.ok(!GENERIC_ANCHOR.test(t), t);
});

test("link status flags", () => {
  const base = { url: "https://example.com/x", redirects: 0, finalUrl: "https://example.com/x", error: null, ms: 120, method: "HEAD" as const };
  assert.deepEqual(linkFlags("b9", { ...base, status: 200 }), []);
  assert.equal(linkFlags("b9", { ...base, status: 404 })[0].rule, "link-broken");
  assert.equal(linkFlags("b9", { ...base, status: 503 })[0].severity, "high");
  const red = linkFlags("b9", { ...base, status: 200, redirects: 2, finalUrl: "https://example.com/y" })[0];
  assert.equal(red.rule, "link-redirect");
  assert.equal(red.severity, "medium");
  assert.equal(linkFlags("b9", { ...base, status: 200, redirects: 1 })[0].severity, "low");
  // Bot protection is not reported as a broken link.
  const blocked = linkFlags("b9", { ...base, status: 403 })[0];
  assert.equal(blocked.rule, "link-error");
  assert.equal(blocked.severity, "low");
  assert.equal(linkFlags("b9", { ...base, status: null, error: "DNS lookup failed (host not found)." })[0].rule, "link-error");
  // Touches: fetched (blue) for a clean checked link, flagged for issues, ok otherwise.
  const a = { id: "b9", tag: "a" as const, text: "Fees", href: base.url };
  assert.equal(touchFor(a, [], { ...base, status: 200 }).action, "fetched");
  assert.equal(touchFor(a, linkFlags("b9", { ...base, status: 404 }), { ...base, status: 404 }).action, "flagged");
  assert.equal(touchFor({ id: "b3", tag: "h2", level: 2, text: "x" }, []).action, "ok");
  assert.equal(touchFor({ id: "b3", tag: "h2", level: 2, text: "x" }, []).kind, "heading");
});

test("URL scope and normalization", () => {
  assert.equal(normalizeStartUrl("example.com"), "https://example.com/");
  assert.equal(normalizeStartUrl("http://Example.com:80/a#x"), "http://example.com/a");
  assert.equal(normalizeStartUrl("https://example.com:8443/"), null);
  assert.equal(normalizeStartUrl("not a url"), null);
  assert.equal(normalizeStartUrl("localhost"), null);
  assert.equal(normalizeUrl("https://example.com/p?utm_source=x&id=2&gclid=y#top"), "https://example.com/p?id=2");
  assert.equal(normalizeUrl("/a/b", "https://example.com/x/"), "https://example.com/a/b");
  assert.equal(normalizeUrl("mailto:x@example.com"), null);
  assert.equal(registrableDomain("https://blog.example.co.uk/x"), "example.co.uk");
  assert.ok(inScope("https://shop.example.com/", "example.com"));
  assert.ok(!inScope("https://example.com.evil.org/", "example.com"));
  assert.ok(!inScope("https://notexample.com/", "example.com"));
  assert.ok(looksLikePage("https://example.com/blog/post"));
  assert.ok(!looksLikePage("https://example.com/brochure.PDF"));
  assert.equal(clampPages(50), 50);
  assert.equal(clampPages(1000), 25);
  assert.equal(clampPages("x"), 25);
});

test("crawl queue: breadth-first, deduplicated, scoped, depth-limited", () => {
  const q = new CrawlQueue("example.com", 3);
  assert.ok(q.offer("https://example.com/", 0, null));
  assert.equal(q.offer("https://example.com/#top", 0, null), null);
  assert.ok(q.offer("https://example.com/b", 2, 0));
  assert.ok(q.offer("https://example.com/a", 1, 0));
  assert.equal(q.offer("https://other.com/", 1, 0), null);
  assert.equal(q.offer("https://example.com/deep", 4, 0), null);
  assert.equal(q.offer("https://example.com/file.zip", 1, 0), null);
  assert.equal(q.offer("https://example.com/a?utm_campaign=x", 1, 0), null);
  assert.deepEqual(
    [q.take()?.url, q.take()?.url, q.take()?.url, q.take()],
    ["https://example.com/", "https://example.com/a", "https://example.com/b", null],
  );
  assert.equal(q.mark("https://example.com/new"), true);
  assert.equal(q.mark("https://example.com/new"), false);
});

test("SSE encoding round-trips across arbitrary chunk boundaries", () => {
  const events: CrawlEvent[] = [
    { type: "skip", skip: { url: "https://example.com/x", reason: "Disallowed by robots.txt\nline two" } },
    { type: "touch", page: 0, touch: { blockId: "b4", kind: "link", action: "fetched", label: "200 · 120 ms" } },
    { type: "error", message: "Ünïcode “quotes”" },
  ];
  const wire = events.map(encodeEvent).join(": ping\n\n");
  assert.match(encodeEvent(events[1]), /^event: touch\ndata: \{.*\}\n\n$/);
  for (const size of [1, 3, 7, 64, wire.length]) {
    const parse = sseParser();
    const out: CrawlEvent[] = [];
    for (let i = 0; i < wire.length; i += size) out.push(...parse(wire.slice(i, i + size)));
    assert.deepEqual(out, events);
  }
  const parse = sseParser();
  assert.deepEqual(parse('event: x\r\ndata: {"type":"error","message":"a"}\r\n\r\n'), [{ type: "error", message: "a" }]);
  assert.deepEqual(parse("data: not json\n\n"), []);
});

test("host gate: one request at a time per host, with a gap; hosts independent", async () => {
  const gate = new HostGate(30);
  const log: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const job = (host: string, name: string) =>
    gate.run(host, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      log.push(`${name}:${Date.now()}`);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
  const t0 = Date.now();
  await Promise.all([job("a", "a1"), job("a", "a2"), job("a", "a3")]);
  assert.equal(maxInFlight, 1);
  const times = log.map((l) => Number(l.split(":")[1]));
  assert.ok(times[1] - times[0] >= 30 && times[2] - times[1] >= 30);
  assert.ok(Date.now() - t0 >= 60);
  log.length = 0;
  await Promise.all([job("b", "b1"), job("c", "c1")]);
  const [b, c] = log.map((l) => Number(l.split(":")[1]));
  assert.ok(Math.abs(b - c) < 25);
  const limit = limiter(2);
  let active = 0;
  let peak = 0;
  await Promise.all(Array.from({ length: 6 }, () => limit(async () => ((active++, (peak = Math.max(peak, active))), await new Promise((r) => setTimeout(r, 3)), active--))));
  assert.equal(peak, 2);
});

test("keyword inference and engine score", () => {
  assert.equal(inferKeyword("https://x.com/blog/mba-admission-process", "Whatever", undefined), "mba admission process");
  assert.equal(inferKeyword("https://x.com/", "Parul University | Vadodara", undefined), "parul university");
  assert.equal(inferKeyword("https://x.com/p/12345", "T", "Hostel Facilities"), "hostel facilities");
  const s = scorePage({ url: URL_, title: "MBA Admission Process 2026", metaDescription: "", canonical: null, robots: "index, follow", schema: "", markdown: "# MBA Admission Process\n\nThe MBA admission process has five steps.\n\n## Eligibility\n\nYou need a degree.", h1: "MBA Admission Process" });
  assert.equal(s.keyword, "mba admission process");
  assert.ok(s.score != null && s.score >= 0 && s.score <= 10);
  assert.ok(s.top.length > 0 && s.top.length <= 5);
  assert.deepEqual(scorePage({ url: URL_, title: "", metaDescription: "", canonical: null, robots: "", schema: "", markdown: "", h1: undefined }).score, null);
});

test("crawl summary", () => {
  const page = (index: number, status: number, score: number | null, flags: PageResult["flags"]): PageResult => ({ index, url: `https://e.com/${index}`, finalUrl: `https://e.com/${index}`, depth: 1, from: 0, status, timing: { ttfbMs: 1, totalMs: 2 }, redirects: 0, title: "", contentType: "text/html", words: 1, blocks: [], touches: [], flags, score: score == null ? null : { score, status: "needs-improvement", keyword: "k", top: [], counts: null }, error: null, linksChecked: 0 });
  const s = summarizeCrawl(
    [
      page(0, 200, 7, [{ rule: "meta-missing", severity: "high", label: "", blockId: "b1" }]),
      page(1, 404, null, [{ rule: "http-error", severity: "critical", label: "", blockId: null }]),
      page(2, 200, 5, [
        { rule: "meta-missing", severity: "high", label: "", blockId: "b1" },
        { rule: "anchor-generic", severity: "low", label: "", blockId: "b9" },
      ]),
    ],
    [{ url: "https://e.com/x", reason: "robots" }],
    1000,
    "Page limit reached (3)",
  );
  assert.equal(s.pages, 3);
  assert.equal(s.errors, 1);
  assert.equal(s.ok, 2);
  assert.equal(s.flags, 4);
  assert.equal(s.avgScore, 6);
  assert.deepEqual(s.bySeverity, { critical: 1, high: 2, medium: 0, low: 1 });
  assert.equal(s.byRule[0].rule, "http-error");
  assert.equal(s.byRule.find((r) => r.rule === "meta-missing")?.count, 2);
  assert.deepEqual(
    s.worst.map((w) => w.index),
    [1, 2, 0],
  );
});

test("host gate: after abort, waiting requests are skipped instead of fired back-to-back", async () => {
  const ctrl = new AbortController();
  const gate = new HostGate(200, ctrl.signal);
  let ran = 0;
  await gate.run("a", async () => void ran++);
  const queued = [gate.run("a", async () => void ran++), gate.run("a", async () => void ran++)];
  setTimeout(() => ctrl.abort(), 10);
  const results = await Promise.allSettled(queued);
  assert.equal(ran, 1);
  assert.ok(results.every((r) => r.status === "rejected" && r.reason instanceof GateStopped));
});

test("link names include screen-reader text, aria-label and SVG titles", () => {
  const html = `<html><body><main>
<p>${"intro ".repeat(130)}</p>
<p>Summary. <a href="/post-1">Continue reading<span class="screen-reader-text"> “MBA fees explained”</span></a></p>
<p><a href="/search"><svg><title>Search the site</title></svg></a> and <a href="/cart"><i class="icon"></i><span class="sr-only">Cart</span></a>
and <a href="/x" aria-label="Open the brochure"><svg aria-hidden="true"></svg></a> and <a href="/y"><img src="/y.png" alt=""></a> and <a href="/z">click here</a></p>
</main></body></html>`;
  const blocks = extractBlocks(html, "https://example.com/");
  const name = (href: string) => blocks.find((b) => b.tag === "a" && b.href === `https://example.com${href}`)?.text;
  assert.equal(name("/post-1"), "Continue reading “MBA fees explained”");
  assert.equal(name("/search"), "Search the site");
  assert.equal(name("/cart"), "Cart");
  assert.equal(name("/x"), "Open the brochure");
  assert.equal(name("/y"), "");
  // The visible sentence still shows only the visible text.
  assert.ok(blocks.some((b) => b.tag === "p" && b.text === "Summary. Continue reading"));
  const flags = inspectPage(facts({ words: 400 }), blocks);
  assert.deepEqual(
    flags.filter((f) => f.rule === "anchor-generic" || f.rule === "anchor-empty").map((f) => [f.rule, blocks.find((b) => b.id === f.blockId)?.href]),
    [
      ["anchor-empty", "https://example.com/y"],
      ["anchor-generic", "https://example.com/z"],
    ],
  );
});

test("div-based and <br><br> text is split into paragraphs before long-paragraph checks", () => {
  const para = (n: number, w: string) => Array.from({ length: n }, () => w).join(" ");
  const html = `<html><body><main>
<div class="post">Lead ${para(59, "lead")}<div>${para(60, "one")}</div><div>${para(60, "two")}</div></div>
<div class="body">${para(60, "first")}<br><br>\n<br>${para(60, "second")}<br>still second</div>
<div class="single">${para(170, "long")}</div>
</main></body></html>`;
  const ps = extractBlocks(html, "https://example.com/").filter((b) => b.tag === "p");
  assert.deepEqual(
    ps.map((b) => [b.text.split(" ")[0], b.words]),
    [
      ["Lead", 60],
      ["one", 60],
      ["two", 60],
      ["first", 60],
      ["second", 62],
      ["long", 170],
    ],
  );
  const flags = inspectPage(facts({ words: 600 }), extractBlocks(html, "https://example.com/"));
  assert.equal(flags.filter((f) => f.rule === "long-paragraph").length, 1);
});

test("crawl summary: pages stopped at a redirect count as errors, so OK + errors = pages", () => {
  const base: PageResult = { index: 0, url: "https://e.com/", finalUrl: "https://e.com/", depth: 0, from: null, status: 200, timing: { ttfbMs: 1, totalMs: 2 }, redirects: 0, title: "", contentType: "text/html", words: 1, blocks: [], touches: [], flags: [], score: null, error: null, linksChecked: 0 };
  const s = summarizeCrawl(
    [base, { ...base, index: 1, status: 301, error: "Redirects outside e.com (https://other.org/)" }, { ...base, index: 2, status: null, error: "Timed out after 15 s." }],
    [],
    1,
    null,
  );
  assert.equal(s.ok, 1);
  assert.equal(s.errors, 2);
});
