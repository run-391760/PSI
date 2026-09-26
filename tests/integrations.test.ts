import assert from "node:assert/strict";
import { test } from "node:test";

process.env.APP_SECRET = "test-secret-for-unit-tests";

const { parseAiOverview, parseGemini, parseOpenAi, parsePerplexity } = await import("../src/lib/providers/ai-engines");
const { dateRange, joinPages, suggestGscSite } = await import("../src/lib/google/data");
const { decryptSecret, encryptSecret } = await import("../src/lib/secrets");

// Shapes below follow each provider's documented example responses (checked September 2026).

test("OpenAI Responses: text, url_citation annotations and web_search_call sources", () => {
  const a = parseOpenAi(
    {
      model: "gpt-6-astra",
      output: [
        { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "best universities", sources: [{ url: "https://a.example/list" }] } },
        {
          type: "message",
          content: [{ type: "output_text", text: "Parul University is often listed.", annotations: [{ type: "url_citation", start_index: 0, end_index: 20, url: "https://paruluniversity.ac.in/", title: "Parul" }] }],
        },
      ],
    },
    "fallback",
  );
  assert.equal(a.text, "Parul University is often listed.");
  assert.deepEqual(a.citations, [{ url: "https://paruluniversity.ac.in/", title: "Parul" }]);
  assert.deepEqual(a.searchResults, [{ url: "https://a.example/list", title: "" }]);
  assert.equal(a.model, "gpt-6-astra");
  assert.ok(a.present);
});

test("Gemini Interactions: model_output text with url_citation annotations", () => {
  const a = parseGemini(
    {
      steps: [
        { type: "thought", summary: [{ type: "text", text: "..." }] },
        { type: "google_search_call", arguments: { queries: ["UEFA Euro 2024 winner"] } },
        { type: "google_search_result", call_id: "search_001", result: [{ search_suggestions: "<!-- -->" }] },
        { type: "model_output", content: [{ type: "text", text: "Spain won Euro 2024...", annotations: [{ type: "url_citation", url: "https://www.aljazeera.com/sports/euro-2024-final", title: "aljazeera.com", start_index: 0, end_index: 56 }] }] },
      ],
    },
    "gemini-3.8-flash",
  );
  assert.equal(a.text, "Spain won Euro 2024...");
  assert.equal(a.citations[0].url, "https://www.aljazeera.com/sports/euro-2024-final");
  assert.equal(a.model, "gemini-3.8-flash");
});

test("Perplexity Agent API: [web:N] citations map to search_results ids", () => {
  const a = parsePerplexity(
    {
      model: "openai/gpt-5.6-luna",
      output: [
        { type: "search_results", queries: ["q"], results: [{ id: 1, title: "One", url: "https://one.example/" }, { id: 2, title: "Two", url: "https://two.example/" }, { id: 3, title: "Three", url: "https://three.example/" }] },
        { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Answer [web:2][web:1].", annotations: [] }] },
      ],
    },
    "preset:low",
  );
  assert.equal(a.text, "Answer [2][1].");
  assert.deepEqual(a.citations.map((c) => c.url), ["https://two.example/", "https://one.example/"]);
  assert.equal(a.searchResults.length, 3);
});

test("AI Overview: absent means no answer; nested text and references are collected", () => {
  assert.equal(parseAiOverview({ items: [{ type: "organic", url: "https://x.example" }] }).present, false);
  const a = parseAiOverview({
    items: [
      { type: "ai_overview", items: [{ type: "ai_overview_element", text: "Parul University is in Vadodara.", references: [{ url: "https://paruluniversity.ac.in/about", title: "About" }] }] },
    ],
  });
  assert.ok(a.present);
  assert.match(a.text, /Vadodara/);
  assert.equal(a.citations[0].url, "https://paruluniversity.ac.in/about");
});

test("Search Console property suggestion prefers the Domain property", () => {
  const sites = [
    { siteUrl: "https://www.example.com/", permissionLevel: "siteOwner" },
    { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
  ];
  assert.equal(suggestGscSite("example.com", sites), "sc-domain:example.com");
  assert.equal(suggestGscSite("example.com", sites.slice(0, 1)), "https://www.example.com/");
  assert.equal(suggestGscSite("other.com", sites), null);
});

test("date ranges are equal length and contiguous", () => {
  const r = dateRange(28);
  const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86400000;
  assert.equal(day(r.end) - day(r.start) + 1, 28);
  assert.equal(day(r.prevEnd) - day(r.prevStart) + 1, 28);
  assert.equal(day(r.start) - day(r.prevEnd), 1);
});

test("landing pages join Search Console and GA4 by path", () => {
  const gsc = { pages: [{ url: "https://example.com/blog/a/", path: "/blog/a/", queries: 3, topQuery: "a", clicks: 10, impressions: 100, ctr: 0.1, position: 4 }] } as never;
  const ga4 = { landingPages: [{ path: "/blog/a", sessions: 7, engagementRate: 0.6, keyEvents: 1 }, { path: "/only-ga", sessions: 2, engagementRate: 0.5, keyEvents: 0 }] } as never;
  const rows = joinPages(gsc, ga4);
  const a = rows.find((r) => r.path === "/blog/a/")!;
  assert.equal(a.clicks, 10);
  assert.equal(a.sessions, 7);
  assert.ok(rows.some((r) => r.path === "/only-ga" && r.clicks === null && r.sessions === 2));
});

test("secrets round-trip and detect tampering", () => {
  const enc = encryptSecret("1//refresh-token");
  assert.notEqual(enc, "1//refresh-token");
  assert.equal(decryptSecret(enc), "1//refresh-token");
  const [iv, tag, data] = enc.split(".");
  assert.throws(() => decryptSecret([iv, tag, Buffer.from("tampered").toString("base64")].join(".")));
  assert.ok(data.length > 0);
});

test("service account JWT assertion is RS256-signed with the right claims", async () => {
  const { generateKeyPairSync, createVerify } = await import("node:crypto");
  const { serviceAccountAssertion } = await import("../src/lib/google/oauth");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const sa = { client_email: "sa@test.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
  const jwt = serviceAccountAssertion(sa, 1_000_000);
  const [h, p, sig] = jwt.split(".");
  assert.ok(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, "base64url")));
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.equal(claims.iss, sa.client_email);
  assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
  assert.equal(claims.exp - claims.iat, 3600);
  assert.match(claims.scope, /webmasters\.readonly/);
  assert.match(claims.scope, /analytics\.readonly/);
});

test("separate service accounts for Search Console and GA4", async () => {
  const { serviceAccount } = await import("../src/lib/google/oauth");
  const key = (email: string) => Buffer.from(JSON.stringify({ client_email: email, private_key: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n" })).toString("base64");
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = key("gsc@test.iam.gserviceaccount.com");
  assert.equal(serviceAccount("gsc")?.client_email, "gsc@test.iam.gserviceaccount.com");
  assert.equal(serviceAccount("ga4")?.client_email, "gsc@test.iam.gserviceaccount.com", "GA4 falls back to the default account");
  process.env.GOOGLE_GA4_SERVICE_ACCOUNT_JSON = key("ga4@test.iam.gserviceaccount.com");
  assert.equal(serviceAccount("ga4")?.client_email, "ga4@test.iam.gserviceaccount.com");
  assert.equal(serviceAccount("gsc")?.client_email, "gsc@test.iam.gserviceaccount.com");
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_GA4_SERVICE_ACCOUNT_JSON;
});
