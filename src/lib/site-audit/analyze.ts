import { THRESHOLDS } from "./checks";
import type { CrawlOutput, CrawlPage } from "./crawl";
import { hamming, jaccardEstimate } from "./extract";
import type { CwvSummary } from "./types";
import { queryParamCount } from "./url";

export type Issue = { check: string; pageId: number | null; url: string; detail: string };

const LINK_ROWS_PER_PAGE = 25;
const HREFLANG_RE = /^([a-z]{2,3})(-([a-z]{4}))?(-([a-z]{2}|\d{3}))?$/i;
const LANG_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;
const ISO639 = new Set(
  "aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu".split(" "),
);
const validHreflang = (code: string) => {
  if (code.toLowerCase() === "x-default") return true;
  const m = HREFLANG_RE.exec(code);
  if (!m) return false;
  const lang = m[1].toLowerCase();
  if (lang.length === 2 && !ISO639.has(lang)) return false;
  if (m[5] && /^[a-z]{2}$/i.test(m[5]) && m[5].toUpperCase() === "UK") return false; // common mistake: en-UK
  return true;
};
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** HTTP error only: timeouts/unreachable targets (status 0) are "unknown", not proof of a broken link. */
const isHttpError = (s: number | null | undefined) => s != null && s >= 400;
const BOT_BLOCK = new Set([401, 403, 407, 429, 999]);

/** Runs every check over a finished crawl. Returns the issues plus derived per-page facts. */
export function analyze(out: CrawlOutput, cwv: CwvSummary | null) {
  const { pages, site } = out;
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const byId = new Map(pages.map((p) => [p.id, p]));
  const issues: Issue[] = [];
  const perPageCheck = new Map<string, number>();
  const add = (check: string, page: CrawlPage | null, detail = "", url?: string) => {
    if (page) {
      const k = `${check}:${page.id}`;
      const n = (perPageCheck.get(k) ?? 0) + 1;
      perPageCheck.set(k, n);
      if (n > LINK_ROWS_PER_PAGE) return;
    }
    issues.push({ check, pageId: page?.id ?? null, url: url ?? page?.url ?? site.origin, detail: detail.slice(0, 600) });
  };

  /* ---------- resolve redirect chains across rows ---------- */
  for (const p of pages) {
    if (!p.data.redirectChain.length) continue;
    let cur = p.finalUrl;
    let hops = p.data.redirectChain.length;
    let loop = p.data.redirectLoop;
    let status: number | null = null;
    const visited = new Set(p.data.redirectChain.map((s) => s.url));
    for (let i = 0; i < 20 && cur && !loop; i++) {
      if (visited.has(cur) && i > 0) {
        loop = true;
        break;
      }
      visited.add(cur);
      const t = byUrl.get(cur);
      if (!t) {
        const x = out.extras.get(cur);
        status = x?.status ?? null;
        break;
      }
      if (t !== p && t.data.redirectChain.length && t.finalUrl && t.finalUrl !== t.url) {
        hops += t.data.redirectChain.length;
        cur = t.finalUrl;
        continue;
      }
      status = t.status;
      break;
    }
    p.data.resolvedFinal = cur;
    p.data.resolvedStatus = status;
    p.data.resolvedHops = hops;
    if (loop) p.data.redirectLoop = true;
  }

  /* ---------- inlinks ---------- */
  const inlinks = new Map<number, Set<number>>();
  for (const l of out.links) {
    if (l.kind !== "a" || !l.internal) continue;
    const t = byUrl.get(l.target);
    if (!t) continue;
    // A link to a redirecting URL also counts for the page it finally lands on.
    const final = t.data.resolvedFinal ? byUrl.get(t.data.resolvedFinal) : undefined;
    for (const target of final && final !== t ? [t, final] : [t]) {
      if (target.id === l.sourceId) continue;
      let s = inlinks.get(target.id);
      if (!s) inlinks.set(target.id, (s = new Set()));
      s.add(l.sourceId);
    }
  }
  const inlinkCount = (p: CrawlPage) => inlinks.get(p.id)?.size ?? 0;

  /* ---------- indexability ---------- */
  const canonicalOf = (p: CrawlPage) => {
    const c = p.data.html?.canonical;
    return c && !c.startsWith("invalid:") ? c : null;
  };
  const selfCanonical = (p: CrawlPage) => {
    const c = canonicalOf(p);
    return !c || c === p.url;
  };
  const indexable = (p: CrawlPage) => !p.data.challenge && !!p.data.html && p.status != null && p.status >= 200 && p.status < 300 && !p.data.html.noindex && selfCanonical(p);

  /** Status of any URL we know about (crawled page, checked resource or extra target). */
  const statusOf = (url: string): { status: number | null; redirect: boolean; final: string | null } => {
    const p = byUrl.get(url);
    if (p) return { status: p.status, redirect: p.status != null && p.status >= 300 && p.status < 400, final: p.data.resolvedFinal ?? p.finalUrl };
    const r = out.resources.get(url);
    if (r?.checked) return { status: r.status, redirect: false, final: null };
    const x = out.extras.get(url);
    if (x) return { status: x.status, redirect: x.status != null && x.status >= 300 && x.status < 400, final: x.location };
    return { status: null, redirect: false, final: null };
  };
  const linkedFrom = (p: CrawlPage) => {
    const n = inlinkCount(p);
    return n ? ` · linked from ${n} page${n === 1 ? "" : "s"}` : p.data.foundOn ? ` · found on ${p.data.foundOn}` : "";
  };
  const chainText = (p: CrawlPage) => [...p.data.redirectChain.map((s) => `${s.url} (${s.status})`), p.data.resolvedFinal ?? p.finalUrl ?? "?"].join(" → ");

  /* ---------- per-page checks ---------- */
  const home = byUrl.get(site.homepage.finalUrl ?? site.homepage.url) ?? byUrl.get(site.homepage.url);
  for (const p of pages) {
    if (p.status == null) {
      if (p.data.blocked) add("robots-blocked", p, `Disallowed for SynapseSEOBot${p.data.foundOn ? ` · found on ${p.data.foundOn}` : ""}`);
      continue;
    }
    if (p.data.challenge) {
      add("bot-challenge", p, p.status != null && p.status >= 300 && p.status < 400 ? `${p.status} → ${p.finalUrl ?? "challenge"}` : `HTTP ${p.status} · “${p.data.html?.title ?? "challenge page"}”`);
      continue;
    }
    if (p.status === 0) {
      add("fetch-failed", p, `${p.data.error ?? "No response"}${linkedFrom(p)}`);
      if (p.inSitemap) add("sitemap-broken-urls", p, `No response · listed in sitemap`);
      continue;
    }
    if (p.status >= 500) add("http-5xx", p, `HTTP ${p.status}${linkedFrom(p)}`);
    else if (p.status >= 400) add("http-4xx", p, `HTTP ${p.status}${linkedFrom(p)}`);
    if (p.inSitemap) {
      if (p.status >= 400) add("sitemap-broken-urls", p, `HTTP ${p.status}`);
      else if (p.status >= 300) add("sitemap-redirects", p, `${p.status} → ${p.data.resolvedFinal ?? p.finalUrl ?? "?"}`);
    }
    if (p.status >= 300 && p.status < 400) {
      if (p.data.redirectLoop) add("redirect-loop", p, `${p.data.error ?? "Loop"}: ${chainText(p)}`);
      else if ((p.data.resolvedHops ?? 1) >= 2) add("redirect-chain", p, `${p.data.resolvedHops} hops: ${chainText(p)}`);
      if (p.data.redirectChain.some((s) => [302, 303, 307].includes(s.status))) add("temporary-redirect", p, `${p.status} → ${p.data.resolvedFinal ?? p.finalUrl ?? "?"}`);
      else add("permanent-redirect", p, `${p.status} → ${p.data.resolvedFinal ?? p.finalUrl ?? "?"}`);
      continue;
    }
    const h = p.data.html;
    if (p.status < 200 || p.status >= 300) continue;

    // Performance (any 2xx document).
    if (p.responseMs != null && p.responseMs > THRESHOLDS.verySlowMs) add("very-slow-page", p, `${(p.responseMs / 1000).toFixed(1)} s to download the HTML`);
    else if (p.responseMs != null && p.responseMs > THRESHOLDS.slowMs) add("slow-page", p, `${(p.responseMs / 1000).toFixed(1)} s to download the HTML`);
    if (!h) continue;
    if ((p.sizeBytes ?? 0) > THRESHOLDS.htmlLarge || p.data.truncated) add("html-large", p, `${((p.sizeBytes ?? 0) / 1e6).toFixed(1)} MB${p.data.truncated ? " (truncated at 5 MB)" : ""}`);
    if (!p.data.headers?.encoding && (p.sizeBytes ?? 0) > 1400) add("uncompressed", p, `${Math.round((p.sizeBytes ?? 0) / 1024)} KB sent without gzip/Brotli`);
    if (h.scripts + h.stylesheets > THRESHOLDS.resourcesMax) add("too-many-resources", p, `${h.scripts} scripts, ${h.stylesheets} stylesheets`);

    // HTTPS
    if (p.url.startsWith("http:")) add("http-pages", p, "Served over plain HTTP");
    if (h.mixedContent.length) add("mixed-content", p, `${h.mixedContent.length} insecure resource${h.mixedContent.length === 1 ? "" : "s"}, e.g. ${h.mixedContent[0]}`);
    if (h.httpLinks) add("http-link-on-https", p, `${h.httpLinks} internal link${h.httpLinks === 1 ? "" : "s"} to http:// URLs`);

    // Indexing directives
    if (h.noindex) add("noindex", p, [h.metaRobots && `meta robots: ${h.metaRobots}`, p.data.headers?.xRobots && `X-Robots-Tag: ${p.data.headers.xRobots}`].filter(Boolean).join(" · "));
    if (h.nofollow) add("nofollow-page", p, [h.metaRobots && `meta robots: ${h.metaRobots}`, p.data.headers?.xRobots && `X-Robots-Tag: ${p.data.headers.xRobots}`].filter(Boolean).join(" · "));
    if (h.metaRefresh) add("meta-refresh", p, `content="${h.metaRefresh.slice(0, 120)}"`);
    if (p.inSitemap && (h.noindex || !selfCanonical(p))) add("sitemap-noindex", p, h.noindex ? "noindex page listed in sitemap" : `Canonical points to ${canonicalOf(p)}`);

    // Canonical
    const valid = [...new Set(h.canonicals.filter((c) => !c.startsWith("invalid:")))];
    if (valid.length > 1) add("multiple-canonicals", p, valid.join(" · "));
    if (h.canonicals.some((c) => c.startsWith("invalid:"))) add("canonical-invalid", p, `href="${h.canonicals.find((c) => c.startsWith("invalid:"))!.slice(8) || ""}"`);
    const canon = canonicalOf(p);
    if (!h.canonicals.length) add("missing-canonical", p);
    else if (canon && canon !== p.url) {
      add("non-canonical", p, `Canonical: ${canon}`);
      const t = statusOf(canon);
      if (isHttpError(t.status)) add("canonical-broken", p, `${canon} → HTTP ${t.status}`);
      else if (t.redirect) add("canonical-redirect", p, `${canon} → ${t.status} → ${t.final ?? "?"}`);
      else {
        const tp = byUrl.get(canon);
        const tc = tp ? canonicalOf(tp) : null;
        if (tc && tc !== canon) add("canonical-chain", p, `${canon} → canonical ${tc}`);
      }
    }
    if (canon && p.url.startsWith("https:") && canon.startsWith("http:")) add("canonical-http", p, canon);

    // Content (skip noindex pages: they are intentionally out of search)
    if (!h.noindex) {
      const tl = h.title?.length ?? 0;
      if (!h.title) add("missing-title", p, h.titleCount ? "Title tag is empty" : "No <title> element");
      else if (tl > THRESHOLDS.titleMax) add("title-too-long", p, `${tl} characters: “${h.title}”`);
      else if (tl < THRESHOLDS.titleMin) add("title-too-short", p, `${tl} characters: “${h.title}”`);
      const dl = h.description?.length ?? 0;
      if (!h.description) add("missing-description", p);
      else if (dl > THRESHOLDS.descMax) add("description-too-long", p, `${dl} characters`);
      else if (dl < THRESHOLDS.descMin) add("description-too-short", p, `${dl} characters: “${h.description}”`);
      if (!h.h1.length) add("missing-h1", p);
      else if (h.h1.length > 1) add("multiple-h1", p, `${h.h1.length} H1s: ${h.h1.slice(0, 3).map((x) => `“${x.slice(0, 60)}”`).join(", ")}`);
      if (h.title && h.h1[0] && norm(h.title) === norm(h.h1[0])) add("title-equals-h1", p, `“${h.title}”`);
      if (h.wordCount < THRESHOLDS.wordsMin) add("low-word-count", p, `${h.wordCount} words`);
      if (h.textRatio < THRESHOLDS.textRatioMin) add("low-text-ratio", p, `${h.textRatio.toFixed(1)}% text`);
    }
    if (h.imagesMissingAlt) add("missing-alt", p, `${h.imagesMissingAlt} of ${h.images} images${h.missingAltSamples[0] ? `, e.g. ${h.missingAltSamples[0]}` : ""}`);

    // Links on the page
    if (h.nofollowInternal) add("nofollow-internal", p, `${h.nofollowInternal} internal link${h.nofollowInternal === 1 ? "" : "s"} with rel=nofollow`);
    if (h.nofollowExternal) add("nofollow-external", p, `${h.nofollowExternal} of ${h.externalLinks} external links`);
    if (h.internalLinks + h.externalLinks > THRESHOLDS.linksMax) add("too-many-links", p, `${h.internalLinks + h.externalLinks} links`);
    if (h.emptyAnchors) add("empty-anchor", p, `${h.emptyAnchors} link${h.emptyAnchors === 1 ? "" : "s"} without text`);
    if (!h.uniqueInternal) add("no-outlinks", p);

    // Markup
    if (!h.viewport) add("viewport-missing", p);
    if (!h.doctype) add("missing-doctype", p);
    if (!h.charset) add("missing-charset", p);
    if (h.jsonLd.errors.length) add("invalid-structured-data", p, h.jsonLd.errors.slice(0, 3).join(" · "));
    if (!h.jsonLd.count && !h.microdata.length) add("no-structured-data", p);
    const ogMissing = ["title", "image"].filter((k) => !h.og[k]);
    if (ogMissing.length) add("missing-og", p, `Missing ${ogMissing.map((k) => `og:${k}`).join(", ")}`);
    if (!h.twitter.card) add("missing-twitter", p, "No twitter:card");
    if (h.frames) add("frames", p);
    if (h.flash) add("flash", p);

    // International
    if (!h.lang) add("missing-lang", p);
    else if (!LANG_RE.test(h.lang)) add("lang-invalid", p, `lang="${h.lang}"`);
    if (h.hreflang.length) {
      const bad = h.hreflang.filter((x) => !validHreflang(x.lang));
      if (bad.length) add("hreflang-invalid-code", p, bad.map((x) => `“${x.lang}”`).join(", "));
      const rel = h.hreflang.filter((x) => !x.href || !/^https?:\/\//i.test(x.raw));
      if (rel.length) add("hreflang-relative", p, rel.map((x) => `${x.lang}: ${x.raw}`).slice(0, 3).join(" · "));
      const byLang = new Map<string, Set<string>>();
      for (const x of h.hreflang) if (x.href) (byLang.get(x.lang.toLowerCase()) ?? byLang.set(x.lang.toLowerCase(), new Set()).get(x.lang.toLowerCase())!).add(x.href);
      const conflicts = [...byLang.entries()].filter(([, s]) => s.size > 1);
      if (conflicts.length) add("hreflang-conflict", p, conflicts.map(([l, s]) => `${l}: ${[...s].slice(0, 2).join(", ")}`).join(" · "));
      const self = h.hreflang.find((x) => x.href === p.url || (canon && x.href === canon));
      if (!self) add("hreflang-no-self", p);
      else if (h.lang && self.lang.toLowerCase() !== "x-default" && self.lang.split("-")[0].toLowerCase() !== h.lang.split("-")[0].toLowerCase())
        add("hreflang-lang-mismatch", p, `hreflang="${self.lang}" but lang="${h.lang}"`);
      if (!h.hreflang.some((x) => x.lang.toLowerCase() === "x-default")) add("hreflang-no-xdefault", p);
      for (const x of h.hreflang) {
        if (!x.href || x.href === p.url) continue;
        const t = byUrl.get(x.href);
        const st = statusOf(x.href);
        if (isHttpError(st.status) || st.redirect) {
          add("hreflang-broken", p, `${x.lang}: ${x.href} → ${st.redirect ? `${st.status} redirect` : `HTTP ${st.status}`}`);
          continue;
        }
        if (t?.data.html && !t.data.html.hreflang.some((b) => b.href === p.url || (canon && b.href === canon))) add("hreflang-no-return", p, `${x.lang}: ${x.href} doesn't link back`);
      }
    }

    // URL hygiene
    try {
      const u = new URL(p.url);
      if (u.pathname.includes("_")) add("underscores-url", p);
    } catch {
      /* ignore */
    }
    if (p.url.length > THRESHOLDS.urlMax) add("url-too-long", p, `${p.url.length} characters`);
    if (queryParamCount(p.url) > THRESHOLDS.paramsMax) add("too-many-params", p, `${queryParamCount(p.url)} parameters`);

    // Architecture
    if (indexable(p) && p !== home) {
      if (p.depth != null && p.depth > THRESHOLDS.depthMax) add("deep-pages", p, `${p.depth} clicks from the homepage`);
      const n = inlinkCount(p);
      if (n === 1) add("single-inlink", p, `Only linked from ${[...(inlinks.get(p.id) ?? [])].map((id) => byId.get(id)?.url).find(Boolean) ?? "one page"}`);
      if (n === 0 && p.inSitemap) add("orphan-sitemap", p, "In sitemap; no crawled page links here");
    }
  }

  /* ---------- duplicates (indexable pages only) ---------- */
  const idx = pages.filter(indexable);
  const dupGroups = (key: (p: CrawlPage) => string | null, check: string, label: (p: CrawlPage) => string) => {
    const groups = new Map<string, CrawlPage[]>();
    for (const p of idx) {
      const k = key(p);
      if (!k) continue;
      const g = groups.get(k);
      if (g) g.push(p);
      else groups.set(k, [p]);
    }
    for (const g of groups.values()) if (g.length > 1) for (const p of g) add(check, p, `Same as ${g.length - 1} other page${g.length === 2 ? "" : "s"}: ${label(p)}`);
  };
  dupGroups((p) => (p.data.html?.title ? norm(p.data.html.title) : null), "duplicate-title", (p) => `“${p.data.html!.title}”`);
  dupGroups((p) => (p.data.html?.description ? norm(p.data.html.description) : null), "duplicate-description", (p) => `“${p.data.html!.description!.slice(0, 120)}”`);
  // Near-duplicate main content: union-find over exact hash and SimHash distance ≤ 3.
  const cand = idx.filter((p) => (p.data.html?.wordCount ?? 0) >= 50);
  const parent = new Map(cand.map((p) => [p.id, p.id]));
  const find = (x: number): number => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!));
  for (let i = 0; i < cand.length; i++)
    for (let j = i + 1; j < cand.length; j++) {
      const a = cand[i].data.html!,
        b = cand[j].data.html!;
      const near = a.minhash && b.minhash ? jaccardEstimate(a.minhash, b.minhash) >= 0.9 : hamming(a.simhash, b.simhash) <= 2;
      if (a.contentHash === b.contentHash || near) parent.set(find(cand[i].id), find(cand[j].id));
    }
  const clusters = new Map<number, CrawlPage[]>();
  for (const p of cand) {
    const r = find(p.id);
    (clusters.get(r) ?? clusters.set(r, []).get(r)!).push(p);
  }
  for (const g of clusters.values())
    if (g.length > 1)
      for (const p of g) {
        const other = g.find((x) => x !== p)!;
        add("duplicate-content", p, `Near-identical to ${other.url}${g.length > 2 ? ` and ${g.length - 2} more` : ""}`);
      }

  /* ---------- links ---------- */
  for (const l of out.links) {
    if (l.kind !== "a") continue;
    const src = byId.get(l.sourceId);
    if (!src) continue;
    if (l.internal) {
      const st = statusOf(l.target);
      if (isHttpError(st.status)) add("broken-internal-links", src, `${l.target} → HTTP ${st.status}`);
      else if (st.redirect) add("links-to-redirects", src, `${l.target} → ${st.final ?? "?"}`);
    } else {
      const ex = out.external.get(l.target);
      if (!ex) continue;
      const broken = (ex.status != null && ex.status >= 400 && !BOT_BLOCK.has(ex.status)) || ex.code === "ENOTFOUND";
      if (broken) add("broken-external-links", src, `${l.target} → ${ex.status ? `HTTP ${ex.status}` : ex.error}`);
    }
  }
  for (const r of out.resources.values()) {
    if (r.blocked && r.kind !== "file")
      for (const id of r.pages.slice(0, 50)) {
        const pg = byId.get(id);
        if (pg) add("blocked-resources", pg, `${r.kind === "image" ? "Image" : r.kind === "script" ? "Script" : "Stylesheet"}: ${r.url}`);
      }
    if (!r.checked || !isHttpError(r.status)) continue;
    const check = r.kind === "image" ? "broken-internal-images" : r.kind === "file" ? "broken-internal-links" : "broken-resources";
    for (const id of r.pages) {
      const pg = byId.get(id);
      if (pg) add(check, pg, `${r.url} → ${r.status === 0 ? (r.error ?? "no response") : `HTTP ${r.status}`}`);
    }
  }

  /* ---------- site-wide ---------- */
  if (site.throttled) add("crawl-throttled", null, site.throttled, site.origin);
  if (!site.robots.found) add("robots-missing", null, site.robots.error ?? `robots.txt returned HTTP ${site.robots.status ?? "n/a"}`, site.robots.url);
  const goodMaps = site.sitemaps.filter((f) => f.status === 200 && (f.kind === "urlset" || f.kind === "index"));
  if (!goodMaps.length && !site.sitemaps.some((f) => f.status === 200)) add("sitemap-missing", null, site.sitemaps.map((f) => `${f.url} → ${f.status ?? "n/a"}`).join(" · ") || "No Sitemap: line in robots.txt", site.sitemaps[0]?.url ?? `${site.origin}/sitemap.xml`);
  for (const f of site.sitemaps) {
    if (f.status === 200 && f.kind === "invalid") add("sitemap-invalid", null, f.errors[0] ?? "Invalid sitemap", f.url);
    if (f.errors.some((e) => /50,000|50 MB/.test(e))) add("sitemap-too-large", null, f.errors.find((e) => /50,000|50 MB/.test(e))!, f.url);
  }
  if (goodMaps.length && !site.robots.sitemaps.length) add("sitemap-not-in-robots", null, `Found ${goodMaps[0].url} but robots.txt has no Sitemap: line`, site.robots.url);
  if (out.sitemapForeign.length) add("sitemap-foreign", null, `${out.sitemapForeign.length} URL(s), e.g. ${out.sitemapForeign[0]}`, goodMaps[0]?.url ?? site.origin);
  if (site.probed) {
    if (!site.llms.found) add("llms-missing", null, site.llms.problems[0] ?? `HTTP ${site.llms.status ?? "n/a"}`, site.llms.url);
    else if (site.llms.problems.length) add("llms-format", null, site.llms.problems.join(" "), site.llms.url);
    if (site.tls?.error) add("cert-invalid", null, site.tls.error, `https://${site.host}/`);
    else if (!site.https.supported) add("https-not-supported", null, site.https.error ?? "HTTPS unavailable", `https://${site.host}/`);
    if (site.tls?.validTo) {
      const days = (new Date(site.tls.validTo).getTime() - Date.now()) / 86400000;
      if (days < 0) add("cert-invalid", null, `Expired on ${site.tls.validTo.slice(0, 10)}`, `https://${site.host}/`);
      else if (days < THRESHOLDS.certDays) add("cert-expiring", null, `Expires on ${site.tls.validTo.slice(0, 10)} (${Math.floor(days)} days)`, `https://${site.host}/`);
    }
    if (site.tls?.protocol && ["TLSv1", "TLSv1.1", "SSLv3"].includes(site.tls.protocol)) add("old-tls", null, `Negotiated ${site.tls.protocol}`, `https://${site.host}/`);
    if (site.https.supported && site.https.httpStatus != null && site.https.httpStatus >= 200 && site.https.httpStatus < 300)
      add("no-https-redirect", null, `http://${site.host}/ returns ${site.https.httpStatus} instead of redirecting`, `http://${site.host}/`);
    else if (site.https.supported && site.https.httpStatus != null && site.https.httpStatus >= 300 && site.https.httpStatus < 400 && site.https.httpRedirects === false)
      add("no-https-redirect", null, `http://${site.host}/ redirects to ${site.https.httpLocation} (not HTTPS)`, `http://${site.host}/`);
    if (site.www.ok === false) add("www-both", null, site.www.note, `${new URL(site.origin).protocol}//${site.www.altHost}/`);
  }
  const homeHeaders = home?.data.headers;
  if (home && homeHeaders && home.url.startsWith("https:")) {
    if (!homeHeaders.hsts) add("no-hsts", null, "Homepage response has no Strict-Transport-Security header", home.url);
    const missing = [!homeHeaders.xcto && "X-Content-Type-Options", !homeHeaders.csp && "Content-Security-Policy"].filter(Boolean);
    if (missing.length) add("missing-security-headers", null, `Homepage lacks ${missing.join(" and ")}`, home.url);
  }

  /* ---------- Core Web Vitals ---------- */
  for (const r of cwv?.pages ?? []) {
    if (!r.ok) continue;
    const pg = byUrl.get(r.url) ?? null;
    const lcp = r.field?.lcp.value ?? r.lab.lcp.value;
    const cls = r.field?.cls.value ?? r.lab.cls.value;
    const src = (field: boolean) => (field ? "field" : "lab");
    if (lcp != null && lcp > 2500) add("cwv-lcp", pg, `LCP ${(lcp / 1000).toFixed(1)} s (${src(r.field?.lcp.value != null)})`, r.url);
    if (cls != null && cls > 0.1) add("cwv-cls", pg, `CLS ${cls.toFixed(2)} (${src(r.field?.cls.value != null)})`, r.url);
    if (r.field?.inp.value != null && r.field.inp.value > 200) add("cwv-inp", pg, `INP ${Math.round(r.field.inp.value)} ms (field)`, r.url);
    if (r.lab.tbt.value != null && r.lab.tbt.value > 200) add("cwv-tbt", pg, `TBT ${Math.round(r.lab.tbt.value)} ms (lab)`, r.url);
    if (r.score != null && r.score < 50) add("psi-low-score", pg, `Performance score ${r.score}/100 (${r.strategy})`, r.url);
  }

  return {
    issues,
    inlinkCount: (id: number) => inlinks.get(id)?.size ?? 0,
    indexable: (p: CrawlPage) => indexable(p),
    statusOf,
  };
}
