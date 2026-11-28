import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";

// Pure parts only: none of these touch the database.
const { chunkText, docxText, extractText, cleanText } = await import("../src/lib/cx/insights/vault");
const { interactions, viewsOf, readPeriod, readPlatformFilters } = await import("../src/lib/cx/listening/platforms");
const { defaultPlan, ASSISTANT_TOOLS } = await import("../src/lib/cx/insights/assistant");

/** Minimal one-entry zip (what a .docx is) holding `word/document.xml`. */
function docx(xml: string, compress = true) {
  const name = Buffer.from("word/document.xml");
  const raw = Buffer.from(xml, "utf8");
  const data = compress ? deflateRawSync(raw) : raw;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(compress ? 8 : 0, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(compress ? 8 : 0, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const cdStart = local.length + name.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([local, name, data, central, name, eocd]);
}

const XML = `<w:document><w:body><w:p><w:r><w:t>Hostel fees 2026</w:t></w:r></w:p><w:p><w:r><w:t>Single room: ₹1,20,000 &amp; meals</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:t>A</w:t></w:p></w:tc><w:tc><w:p><w:t>B</w:t></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;

test("docx text: paragraphs, entities and table cells (deflated and stored)", () => {
  for (const compress of [true, false]) {
    const t = docxText(docx(XML, compress));
    assert.match(t, /Hostel fees 2026\nSingle room: ₹1,20,000 & meals\n/);
    assert.match(t, /A\n \| B/);
  }
});

test("extractText: routes by extension, rejects PDF and unknown types with a clear message", () => {
  assert.match(extractText("fees.docx", docx(XML)), /Single room/);
  assert.equal(extractText("a.md", Buffer.from("# Title\nBody")), "# Title\nBody");
  assert.equal(extractText("page.html", Buffer.from("<html><body><script>x()</script><p>Hello <b>PU</b></p></body></html>")).trim(), "Hello PU");
  assert.throws(() => extractText("brochure.pdf", Buffer.from("%PDF")), /PDF is not supported/);
  assert.throws(() => extractText("photo.png", Buffer.from("x")), /Unsupported file type/);
  assert.throws(() => docxText(Buffer.from("not a zip at all, definitely not")), /not a valid Word document/);
});

test("chunkText: keeps paragraphs together up to the size and splits long ones", () => {
  const paras = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ${"word ".repeat(60)}`.trim());
  const chunks = chunkText(paras.join("\n\n"), 700);
  assert.ok(chunks.length >= 3 && chunks.length <= 6);
  assert.ok(chunks.every((c) => c.length <= 700));
  assert.equal(chunks.join(" ").match(/Paragraph \d/g)?.length, 6);
  const long = chunkText(`${"This is a sentence. ".repeat(200)}`, 500);
  assert.ok(long.length >= 8 && long.every((c) => c.length <= 500));
  assert.deepEqual(chunkText("Short note."), ["Short note."]);
  assert.equal(cleanText("a\r\n\r\n\r\n\r\nb\t\tc"), "a\n\nb c");
});

test("platform engagement: sums interaction counters only, views separately, null when none", () => {
  assert.equal(interactions({ likes: 3, replies: 2, reposts: 1 }), 6);
  assert.equal(interactions({ score: 10, comments: 4, rating: 5, replied: 1 }), 14);
  assert.equal(interactions({ views: 900 }), null);
  assert.equal(interactions({}), null);
  assert.equal(viewsOf({ views: 900 }), 900);
  assert.equal(viewsOf({ likes: 1 }), null);
});

test("platform period and filters: presets, custom range, validation", () => {
  const now = new Date("2026-11-20T10:00:00Z");
  assert.deepEqual(readPeriod({}, now), { days: 7, from: "2026-11-14", to: "2026-11-20", label: "Last 7 days", custom: false });
  assert.equal(readPeriod({ days: "30" }, now).from, "2026-10-22");
  assert.equal(readPeriod({ days: "45" }, now).days, 7);
  assert.deepEqual(readPeriod({ from: "2026-11-01", to: "2026-11-10" }, now), { days: 10, from: "2026-11-01", to: "2026-11-10", label: "2026-11-01 to 2026-11-10", custom: true });
  assert.equal(readPeriod({ from: "2026-11-10", to: "2026-11-01" }, now).custom, false);
  const f = readPlatformFilters({ sentiment: "angry", sort: "engagement", day: "2026-11-05", page: "0" });
  assert.equal(f.sentiment, undefined);
  assert.equal(f.sort, "engagement");
  assert.equal(f.day, "2026-11-05");
  assert.equal(f.page, 1);
  assert.equal(readPlatformFilters({ sentiment: "unknown" }).sentiment, "unknown");
});

test("assistant fallback plan covers platforms and the vault", () => {
  const p = defaultPlan("hostel wifi complaints");
  assert.deepEqual(p.map((c) => c.tool), ["platform_overview", "search_knowledge"]);
  assert.equal(p[1].query, "hostel wifi complaints");
  for (const c of p) assert.ok(c.tool in ASSISTANT_TOOLS);
});
