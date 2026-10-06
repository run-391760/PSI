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

// ------------------------------------------------------------------ credential registry (one key map)

test("registry: ids are unique and every env credential names a variable from .env.example", async () => {
  const { readFileSync } = await import("node:fs");
  const { CREDENTIALS, credentialEnvVars } = await import("../src/lib/integrations/registry");
  const { PROVIDER_INFO } = await import("../src/lib/data-mode");
  const documented = new Set([...readFileSync(new URL("../.env.example", import.meta.url), "utf8").matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
  assert.equal(new Set(CREDENTIALS.map((c) => c.id)).size, CREDENTIALS.length);
  for (const c of CREDENTIALS) {
    for (const v of credentialEnvVars(c)) assert.ok(documented.has(v), `${c.id}: ${v} is missing from .env.example`);
    if (c.storage === "env") assert.ok(c.configured, `${c.id}: env credentials need a configured() resolver`);
    else assert.ok(c.savedAt && !c.configured, `${c.id}: saved credentials say where they are saved`);
    assert.ok(c.powers.length > 0, `${c.id}: powers nothing`);
  }
  for (const [id, info] of Object.entries(PROVIDER_INFO)) for (const v of info.env) assert.ok(documented.has(v), `PROVIDER_INFO.${id}: ${v} is missing from .env.example`);
});

test("registry: every powers and savedAt link is a real route", async () => {
  const { readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { CREDENTIALS } = await import("../src/lib/integrations/registry");
  const app = fileURLToPath(new URL("../src/app", import.meta.url));
  const routes = new Set<string>();
  const walk = (dir: string, parts: string[]) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), /^\(.*\)$/.test(e.name) ? parts : [...parts, e.name]);
      else if (e.name === "page.tsx") routes.add(`/${parts.join("/")}`);
    }
  };
  walk(app, []);
  assert.ok(routes.has("/optimizer") && routes.has("/cx/inbox"), "route scan found the app");
  for (const c of CREDENTIALS) {
    const links = [...c.powers.map((p) => p.href), ...(c.savedAt ? [c.savedAt.href] : [])];
    for (const href of links) assert.ok(routes.has(href.split("?")[0]), `${c.id}: ${href} is not a route`);
    for (const p of c.powers) assert.equal(p.href.startsWith("/cx"), p.workspace === "CX", `${c.id}: ${p.feature} is in the wrong workspace`);
  }
});

test("registry: Pre-Publish Optimizer and CX AI are mapped to the right keys", async () => {
  const { credential } = await import("../src/lib/integrations/registry");
  const powers = (id: string) => credential(id)!.powers.map((p) => p.href);
  for (const id of ["anthropic", "openai", "gemini", "dataforseo", "google", "pagespeed"]) assert.ok(powers(id).includes("/optimizer"), `${id} powers the optimizer`);
  assert.ok(!powers("perplexity").includes("/optimizer"));
  for (const id of ["anthropic", "openai", "gemini"]) for (const h of ["/cx/inbox", "/cx/ask", "/cx/quality", "/cx/crisis", "/cx/publishing"]) assert.ok(powers(id).includes(h), `${id} powers ${h}`);
  assert.ok(powers("openai").includes("/cx/publishing/assets"), "image generation needs OpenAI");
  assert.ok(!powers("pagespeed").includes("/on-page-checker"), "PageSpeed is not read by the On Page SEO Checker");
  for (const id of ["meta", "whatsapp", "linkedin", "x", "youtube", "reddit", "bluesky"]) assert.ok(powers(id).some((h) => h.startsWith("/cx")), `${id} is a CX channel`);
});

test("credentialStatus reports flags and never secret values", async () => {
  const { credentialStatus } = await import("../src/lib/integrations/registry");
  const saved = { ...process.env };
  process.env.DATAFORSEO_LOGIN = "login-value-xyz";
  process.env.DATAFORSEO_PASSWORD = "password-value-xyz";
  process.env.OPENAI_API_KEY = "sk-value-xyz";
  delete process.env.ANTHROPIC_API_KEY;
  process.env.ENABLE_PAGESPEED = "false";
  try {
    const st = credentialStatus();
    const json = JSON.stringify(st);
    assert.ok(!/value-xyz/.test(json), "no values in the status");
    const by = (id: string) => st.items.find((i) => i.id === id)!;
    assert.equal(by("dataforseo").configured, true);
    assert.equal(by("anthropic").configured, false);
    assert.equal(by("openai").configured, true);
    assert.equal(by("pagespeed").configured, false);
    assert.equal(by("pagespeed").unsetOk, true);
    assert.equal(by("db-mailbox").configured, null);
    assert.equal(st.llm, true);
    assert.deepEqual(by("dataforseo").env, [[{ name: "DATAFORSEO_LOGIN", set: true }, { name: "DATAFORSEO_PASSWORD", set: true }]]);
  } finally {
    for (const k of ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ENABLE_PAGESPEED"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test("providerStatus: PageSpeed follows pagespeedEnabled() and llm follows llmConfigured()", async () => {
  const { providerStatus } = await import("../src/lib/data-mode");
  const saved = { ...process.env };
  try {
    delete process.env.PAGESPEED_API_KEY;
    delete process.env.ENABLE_PAGESPEED;
    for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]) delete process.env[k];
    process.env.PERPLEXITY_API_KEY = "pplx-test";
    const st = providerStatus();
    assert.equal(st.pagespeed, true, "PageSpeed works without a key");
    assert.equal(st.ai, true, "any AI-visibility engine counts");
    assert.equal(st.llm, false, "Perplexity alone does not power writing features");
  } finally {
    for (const k of ["PAGESPEED_API_KEY", "ENABLE_PAGESPEED", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "PERPLEXITY_API_KEY"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test("registry: token-per-brand channels are not 'Configured' without keys, and the token pair counts", async () => {
  const { credentialStatus } = await import("../src/lib/integrations/registry");
  const keys = ["META_APP_SECRET", "META_VERIFY_TOKEN", "META_PAGE_ACCESS_TOKEN", "LINKEDIN_ACCESS_TOKEN", "THREADS_USER_ID", "THREADS_ACCESS_TOKEN", "GBP_LOCATION", "GBP_ACCESS_TOKEN"];
  const saved = { ...process.env };
  try {
    for (const k of keys) delete process.env[k];
    let by = (id: string) => credentialStatus().items.find((i) => i.id === id)!;
    for (const id of ["meta", "linkedin", "threads", "gbp"]) {
      assert.equal(by(id).configured, false, `${id} is not configured without keys`);
      assert.equal(by(id).unsetOk, true, `${id}: a brand-saved token can serve, so no warning`);
    }
    assert.ok(!by("meta").env.flat().some((v) => v.name === "META_APP_ID"), "META_APP_ID is read by no API call");
    assert.ok(!by("linkedin").env.flat().some((v) => v.name.startsWith("LINKEDIN_CLIENT")), "LinkedIn reads only a token");
    process.env.META_PAGE_ACCESS_TOKEN = "page-token";
    process.env.THREADS_USER_ID = "1";
    process.env.THREADS_ACCESS_TOKEN = "t";
    by = (id: string) => credentialStatus().items.find((i) => i.id === id)!;
    assert.equal(by("meta").configured, true);
    assert.match(by("meta").hint ?? "", /META_APP_SECRET/, "webhook pair still missing");
    assert.equal(by("threads").configured, true, "the Threads token pair is enough");
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test(".env.example has no inline comments (docker --env-file keeps them in the value)", async () => {
  const { readFileSync } = await import("node:fs");
  const lines = readFileSync(new URL("../.env.example", import.meta.url), "utf8").split("\n");
  for (const l of lines) if (/^[A-Z][A-Z0-9_]*=/.test(l)) assert.ok(!/\s#/.test(l), `inline comment: ${l}`);
});
