import { wordList } from "@/lib/content/text";
import { STOP, type Ctx } from "../context";
import { contentTokens, stem } from "../parse";
import type { Finding, FixOption } from "../types";
import { detectClaims, sourceQuality } from "./claims";
import { clamp01, finding, pct, phraseHits, plural, quote } from "./util";

/** E-E-A-T & Trust module and the External Link Auditor. */

const YMYL = /\b(health|medical|medicine|doctor|disease|treatment|drug|dosage|finance|financial|loan|tax|invest|investment|insurance|legal|law|lawyer|visa|immigration|admission|admissions|fees|scholarship|career|salary|exam|neet|jee|safety)\b/i;

export function author(ctx: Ctx): Finding {
  const a = ctx.draft.meta.author ?? {};
  const ymyl = YMYL.test(`${ctx.kw} ${ctx.draft.title}`);
  const bioWords = wordList(a.bio ?? "").length;
  const topic = new Set(contentTokens(`${ctx.kw} ${ctx.draft.title}`, STOP).map(stem));
  const relevant = !!a.bio && contentTokens(`${a.bio} ${a.credentials ?? ""}`, STOP).map(stem).some((t) => topic.has(t) || /\b(professor|dr|phd|faculty|counsel|expert|lead|head|dean|director|manager|specialist|consultant|engineer|doctor|lawyer|advisor|editor)/i.test(t));
  const parts = [
    { label: "Author named", ok: !!a.name?.trim(), w: 0.35 },
    { label: "Author bio", ok: bioWords >= 15, w: 0.2 },
    { label: "Credentials / role", ok: !!a.credentials?.trim(), w: ymyl ? 0.2 : 0.15 },
    { label: "Profile page link", ok: !!a.url?.trim(), w: 0.1 },
    { label: "Relevant expertise", ok: relevant, w: ymyl ? 0.15 : 0.2 },
  ];
  const total = parts.reduce((s, p) => s + p.w, 0);
  const score = parts.reduce((s, p) => s + (p.ok ? p.w : 0), 0) / total;
  return finding("author", score, a.name ? `By ${a.name}${a.credentials ? `, ${a.credentials}` : ""}${ymyl ? " — YMYL topic: expertise matters more" : ""}.` : `No author set${ymyl ? " on a YMYL topic (education, money, health, careers)" : ""}.`, ["content"], {
    items: parts.map((p) => ({ label: p.label, detail: p.ok ? "Present" : "Missing", tone: p.ok ? ("good" as const) : ymyl && p.w >= 0.2 ? ("critical" as const) : ("warning" as const) })),
    how: score < 0.8 ? "Add the author's name, a short bio showing relevant experience, credentials and a link to their profile page (form above)." : undefined,
  });
}

const EVIDENCE: { type: string; re: RegExp }[] = [
  { type: "First-hand observation", re: /\b(we|i) (tested|tried|found|noticed|observed|visited|spoke|interviewed|surveyed|analy[sz]ed|measured|built|ran)\b|\bin (our|my) experience\b/i },
  { type: "Case study / example", re: /\b(case study|for example|for instance|real[- ]world example|success story)\b/i },
  { type: "Original data", re: /\b(our (data|survey|research|analysis|study|records)|we (collected|surveyed|tracked)|according to our)\b/i },
  { type: "Expert quote", re: /\b(said|says|explains|according to) (dr\.?|prof\.?|professor|[A-Z][a-z]+ [A-Z][a-z]+)|“[^”]{20,}”\s*[—–-]\s*[A-Z]/ },
  { type: "Methodology / testing", re: /\b(methodology|how we (tested|chose|ranked|evaluated)|criteria|we compared|test(ed|ing) (on|with|for))\b/i },
];

export function experienceSignals(ctx: Ctx): Finding {
  const d = ctx.doc;
  const found = EVIDENCE.filter((e) => e.re.test(`${d.plain}\n${ctx.draft.body}`));
  const photos = d.images.filter((i) => i.caption).length;
  const types = found.length + (photos ? 1 : 0);
  const h = clamp01(types / 4);
  const score = ctx.ai ? (h + ctx.ai.experience.score) / 2 : h;
  return finding("experience-signals", score, `${plural(types, "type")} of experience evidence: ${[...found.map((f) => f.type), ...(photos ? ["Original captioned images"] : [])].join(", ") || "none"}.`, ctx.ai ? ["content", "ai"] : ["content"], {
    items: [...EVIDENCE.map((e) => ({ label: e.type, detail: found.includes(e) ? "Present" : "Not found", tone: found.includes(e) ? ("good" as const) : ("neutral" as const) })), { label: "Original captioned images", detail: photos ? `${photos}` : "Not found", tone: photos ? ("good" as const) : ("neutral" as const) }],
    how: score < 0.8 ? "Show experience with at least three kinds of evidence: what you observed, a real example, your own data, a named expert and how you evaluated things." : undefined,
  });
}

export function trustSignals(ctx: Ctx): Finding {
  const m = ctx.draft.meta;
  const d = ctx.doc;
  const ext = d.links.filter((l) => !l.internal && /^https?:/i.test(l.url));
  const commercial = ctx.intent.dominant === "commercial" || ctx.intent.dominant === "transactional";
  const highRisk = detectClaims(d).filter((c) => c.risk === "high" && !c.supported).length;
  const parts = [
    { label: "Author", ok: !!m.author?.name },
    { label: "Organization / publisher", ok: !!m.organization?.name },
    { label: "Published or updated date", ok: !!(m.publishedAt || m.modifiedAt) },
    { label: "About / contact reachable", ok: !!m.organization?.url || d.links.some((l) => /\/(about|contact)/i.test(l.url)) },
    { label: "Credible sources cited", ok: ext.some((l) => sourceQuality(l.url) === "credible") },
    ...(commercial ? [{ label: "Disclosure (sponsored / affiliate / own product)", ok: /\b(disclosure|sponsored|affiliate|we may earn|commission|our own (program|product|course)|paid partnership)\b/i.test(d.plain) }] : []),
    { label: "No unsupported high-risk claims", ok: highRisk === 0 },
  ];
  const score = parts.filter((p) => p.ok).length / parts.length;
  return finding("trust-signals", score, `${parts.filter((p) => p.ok).length} of ${parts.length} trust signals present.`, ["content"], {
    items: parts.map((p) => ({ label: p.label, detail: p.ok ? "Present" : "Missing", tone: p.ok ? ("good" as const) : ("warning" as const) })),
    how: score < 0.8 ? "Fill in author, publisher and dates (E-E-A-T and Technical SEO tabs), cite credible sources and disclose commercial relationships." : undefined,
  });
}

export function claimRisk(ctx: Ctx): Finding {
  const claims = detectClaims(ctx.doc).filter((c) => c.risk !== "low");
  const ai = (ctx.ai?.claims ?? []).filter((c) => c.risk !== "low");
  const high = claims.filter((c) => c.risk === "high" && !c.supported);
  const highSupported = claims.filter((c) => c.risk === "high" && c.supported);
  const medium = claims.filter((c) => c.risk === "medium" && !c.supported);
  const aiHigh = ai.filter((c) => c.risk === "high");
  const score = clamp01(1 - high.length * 0.35 - aiHigh.length * 0.15 - medium.length * 0.06 - highSupported.length * 0.05);
  const fixes: FixOption[] = [...high, ...medium].length
    ? [{ id: "claims-soften", label: `Qualify ${plural(Math.min(8, high.length + medium.length), "risky claim")} with Claude`, description: "Claude rewrites absolute or unsupported claims into accurate, qualified statements (and marks where a source is needed).", ai: { task: "claims", instruction: `Rewrite these claims so they are accurate and qualified (no guarantees, no unqualified superlatives); where a fact needs evidence, add [source needed]:\n${[...high, ...medium].slice(0, 8).map((c) => `- ${c.text}`).join("\n")}` }, safe: false }]
    : [];
  return finding("claim-risk", score, high.length ? `${plural(high.length, "high-risk claim")} without support (${[...new Set(high.map((c) => c.riskReason))].join(", ")}).` : medium.length ? `${plural(medium.length, "absolute or superlative claim")} to qualify; no high-risk claims.` : "No unsupported high-risk claims.", ctx.ai ? ["content", "ai"] : ["content"], {
    items: [
      ...high.map((c) => ({ label: quote(c.text, 180), detail: `High risk: ${c.riskReason} · no source`, tone: "critical" as const })),
      ...highSupported.map((c) => ({ label: quote(c.text, 160), detail: `High risk: ${c.riskReason} · has a source — verify it says exactly this`, tone: "warning" as const })),
      ...medium.slice(0, 8).map((c) => ({ label: quote(c.text, 160), detail: `${c.riskReason}`, tone: "warning" as const })),
      ...aiHigh.map((c) => ({ label: `Claude: ${quote(c.text, 160)}`, detail: c.reason, tone: "critical" as const })),
    ],
    fixes,
    blocker: high.length ? `${plural(high.length, "unsupported high-risk claim")} (e.g. ${quote(high[0].text, 90)}): support with a source or rewrite before publishing.` : undefined,
  });
}

export function freshness(ctx: Ctx): Finding {
  const year = ctx.now.getFullYear();
  const d = ctx.doc;
  const old = d.sentences.filter((s) => {
    const ys = (s.match(/\b(19|20)\d{2}\b/g) ?? []).map(Number).filter((y) => y >= 1990 && y <= year);
    return ys.length && Math.max(...ys) <= year - 3 && /\d+\s?%|\b(survey|report|data|study|statistics|according to|ranked|fees?|salary|cost|price)\b/i.test(s);
  });
  const titleYears = (ctx.draft.title.match(/\b(20\d{2})\b/g) ?? []).map(Number);
  const staleTitle = titleYears.some((y) => y < year);
  const relative = phraseHits(d.plain, ["last year", "this year", "next year", "recently", "currently", "right now", "nowadays"]);
  const timeSensitive = /\b(fees?|admission|admissions|ranking|rankings|best|top|salary|cut ?off|exam|dates?|deadline|price|cost|schedule|news|latest|new)\b/i.test(`${ctx.kw} ${ctx.draft.title}`);
  const mentionsCurrent = new RegExp(`\\b(${year}|${year + 1})\\b`).test(`${ctx.draft.title} ${d.plain}`);
  const modified = ctx.draft.meta.modifiedAt || ctx.draft.meta.publishedAt;
  const ageDays = modified ? (ctx.now.getTime() - new Date(modified).getTime()) / 86400000 : null;
  const score = clamp01(1 - old.length * 0.15 - (staleTitle ? 0.3 : 0) - (relative.length ? 0.1 : 0) - (timeSensitive && !mentionsCurrent ? 0.2 : 0) - (ageDays != null && ageDays > 365 ? 0.15 : 0));
  const fixes: FixOption[] = staleTitle
    ? [{ id: "freshness-title-year", label: `Update the title year to ${year}`, description: "Replaces the old year in the SEO title. Only do this after updating the content.", fix: { kind: "set", field: "title", value: ctx.draft.title.replace(/\b20\d{2}\b/g, String(year)) }, safe: false }]
    : [];
  return finding("freshness", score, old.length || staleTitle || relative.length ? `${plural(old.length, "dated statistic/reference")}${staleTitle ? ", an old year in the title" : ""}${relative.length ? `, ${plural(relative.length, "relative time phrase")}` : ""}.` : "No outdated statistics, dates or references detected.", ["content"], {
    items: [
      ...old.slice(0, 8).map((s) => ({ label: quote(s, 170), detail: "Statistic or reference 3+ years old: update or confirm it is still accurate", tone: "warning" as const })),
      ...(staleTitle ? [{ label: `Title mentions ${titleYears.join(", ")}`, tone: "critical" as const }] : []),
      ...relative.map((r) => ({ label: `“${r.phrase}”`, detail: "Ambiguous once the article ages — use a date", tone: "neutral" as const })),
      ...(timeSensitive && !mentionsCurrent ? [{ label: `Time-sensitive topic without ${year} information`, detail: "Fees, rankings, admissions and dates change every year.", tone: "warning" as const }] : []),
      ...(ageDays != null && ageDays > 365 ? [{ label: `Last updated ${Math.round(ageDays / 30)} months ago`, tone: "warning" as const }] : []),
    ],
    fixes,
    how: score < 0.8 ? "Replace old statistics with the latest figures (with sources), use absolute dates, and set the modified date when you update." : undefined,
  });
}

export function externalLinks(ctx: Ctx): Finding {
  const ext = ctx.doc.links.filter((l) => !l.internal && /^https?:/i.test(l.url));
  const claims = detectClaims(ctx.doc).length;
  if (!ext.length) return finding("external-links", claims ? 0.4 : 0.8, claims ? `No outbound links, but ${plural(claims, "claim")} that should cite sources.` : "No outbound links (none required by the content).", ["content"], { how: claims ? "Link the primary sources behind your figures and facts." : undefined });
  const generic = ext.filter((l) => /^(click here|here|this|link|read more|learn more|this article|source|website)$/i.test(l.text.trim()));
  const insecure = ext.filter((l) => /^http:\/\//i.test(l.url));
  const weak = ext.filter((l) => sourceQuality(l.url) === "weak");
  const byDomain = new Map<string, number>();
  for (const l of ext) {
    try {
      const h = new URL(l.url).hostname.replace(/^www\./, "");
      byDomain.set(h, (byDomain.get(h) ?? 0) + 1);
    } catch {
      /* invalid */
    }
  }
  const heavy = [...byDomain.entries()].filter(([, n]) => n > 3);
  const checked = ctx.links?.results ?? [];
  const broken = checked.filter((r) => ext.some((l) => l.url === r.url) && (r.error || (r.status != null && r.status >= 400)));
  const credible = ext.filter((l) => sourceQuality(l.url) === "credible").length;
  const score = clamp01(1 - broken.length * 0.25 - generic.length * 0.1 - insecure.length * 0.08 - weak.length * 0.1 - heavy.length * 0.1 + (credible ? 0.05 : 0));
  return finding("external-links", score, `${plural(ext.length, "outbound link")}: ${credible} authoritative${broken.length ? `, ${broken.length} broken` : ""}${generic.length ? `, ${generic.length} with generic anchors` : ""}${ctx.links ? "" : " (not checked for broken links yet)"}.`, ctx.links ? ["content", "live-url"] : ["content"], {
    items: ext.map((l) => {
      const r = checked.find((x) => x.url === l.url);
      const bad = r && (r.error || (r.status != null && r.status >= 400));
      const q = sourceQuality(l.url);
      return { label: l.text || l.url, detail: [l.url, r ? (bad ? `broken: ${r.error ?? `HTTP ${r.status}`}` : `HTTP ${r.status}`) : null, q !== "neutral" ? q : null, /^http:\/\//i.test(l.url) ? "not HTTPS" : null].filter(Boolean).join(" · "), tone: bad ? ("critical" as const) : q === "weak" || /^http:/i.test(l.url) ? ("warning" as const) : q === "credible" ? ("good" as const) : ("neutral" as const), href: l.url };
    }),
    how: score < 0.8 ? "Fix broken links, use descriptive anchor text, prefer HTTPS and authoritative primary sources." : undefined,
  });
}
