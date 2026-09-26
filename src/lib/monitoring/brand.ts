import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { tryRootDomain } from "@/lib/domain";
import type { Project } from "@/lib/projects";
import { searchNews } from "@/lib/providers/news";
import { clamp, domainEntity, rng, topicFor } from "@/lib/seo/engine";
import { CHANNELS, type BrandSettings, type Mention, type MentionStatus } from "./meta";
import { brandName } from "./names";
import { analyzeSentiment, type Sentiment } from "./sentiment";

/**
 * Brand Monitoring: real mentions from Google News RSS (source "google-news") plus optional,
 * clearly-labelled demo social/forum mentions (source "demo"). Mentions are stored per project in
 * bm_mentions; competitor mentions (subject = competitor name) feed share of voice only.
 */

export { CHANNELS, type BrandSettings, type Mention, type MentionStatus };

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function trackedTerms(project: Pick<Project, "brand_terms" | "domain">) {
  const terms = project.brand_terms.map((t) => t.trim()).filter(Boolean);
  return terms.length ? terms.slice(0, 5) : [brandName(project.domain)];
}
export function defaultCompetitorTerms(project: Pick<Project, "competitors">) {
  return project.competitors.slice(0, 5).map(brandName);
}

export async function getBrandSettings(projectId: string): Promise<BrandSettings | null> {
  const [row] = await query<{ competitor_terms: string[]; demo_social: boolean; created_at: Date | string; last_run_at: Date | string | null; last_error: string | null }>(
    "SELECT competitor_terms,demo_social,created_at,last_run_at,last_error FROM bm_settings WHERE project_id=$1",
    [projectId],
  );
  if (!row) return null;
  return {
    competitorTerms: row.competitor_terms,
    demoSocial: row.demo_social,
    createdAt: new Date(row.created_at).toISOString(),
    lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
    lastError: row.last_error,
  };
}

export async function saveBrandSettings(projectId: string, s: { competitorTerms: string[]; demoSocial: boolean }) {
  await query(
    `INSERT INTO bm_settings(project_id,competitor_terms,demo_social) VALUES($1,$2::jsonb,$3)
     ON CONFLICT(project_id) DO UPDATE SET competitor_terms=excluded.competitor_terms, demo_social=excluded.demo_social`,
    [projectId, JSON.stringify(s.competitorTerms), s.demoSocial],
  );
}

// ---------------------------------------------------------------------------------------------- enrichment

const TAG_RULES: [string, RegExp][] = [
  ["Admissions", /\b(admission|admissions|apply|application|enrol|enroll|intake|cut ?off|counselling)\b/i],
  ["Careers", /\b(placement|placements|recruit|recruitment|hiring|jobs?|salary|package|internship)\b/i],
  ["Awards & rankings", /\b(award|awards|awarded|ranked|ranking|rankings|accredit\w*|nirf|naac|honou?r\w*|recogni[sz]\w*)\b/i],
  ["Events", /\b(fest|festival|event|conference|summit|convocation|seminar|workshop|webinar|hackathon|celebrat\w*)\b/i],
  ["Partnerships", /\b(partner\w*|mou|collaborat\w*|tie-?up|alliance|joins hands)\b/i],
  ["Product & launches", /\b(launch\w*|introduc\w*|unveil\w*|rolls? out|new)\b/i],
  ["Research", /\b(research|study|patent|paper|innovation|centre for|center for)\b/i],
  ["Business", /\b(funding|invest\w*|revenue|profit|ipo|shares?|acquisition|acquires|expansion)\b/i],
  ["Complaints & risk", /\b(complain\w*|fraud|scam|protest\w*|lawsuit|probe|fir|arrest\w*|controvers\w*|allegation\w*|refund|ragging|suicide)\b/i],
  ["Sports", /\b(cricket|football|sports?|tournament|olympic\w*|athlete|medal)\b/i],
];
export function autoTags(text: string) {
  return TAG_RULES.filter(([, re]) => re.test(text)).map(([t]) => t).slice(0, 3);
}

/** Estimated audience of a source (demo engine: derived from the site's synthetic authority). */
export function reachEstimate(domain: string | null, channel: string) {
  if (!domain) return 0;
  const strength = domainEntity(domain).strength;
  const base = 10 ** (3 + 4.3 * strength);
  const channelFactor = channel === "news" ? 1 : channel === "reddit" ? 0.02 : channel === "youtube" ? 0.015 : 0.01;
  return Math.round(clamp(base * channelFactor * (0.6 + 0.8 * rng(`reach:${domain}`).next()), 100, 80_000_000));
}

type Row = Omit<Mention, "id" | "status"> & { dedupeKey: string };

async function insertMentions(projectId: string, rows: Row[]) {
  const inserted: { sentiment: Sentiment; published_at: Date | string; title: string; subject: string }[] = [];
  for (const r of rows) {
    const res = await query<{ sentiment: Sentiment; published_at: Date | string; title: string; subject: string }>(
      `INSERT INTO bm_mentions(id,project_id,subject,term,source,channel,publisher,publisher_domain,title,snippet,url,dedupe_key,published_at,sentiment,sentiment_score,reach,tags)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
       ON CONFLICT(project_id,dedupe_key) DO NOTHING RETURNING sentiment,published_at,title,subject`,
      [randomUUID(), projectId, r.subject, r.term, r.source, r.channel, r.publisher, r.publisherDomain, r.title.slice(0, 500), r.snippet.slice(0, 1000), r.url, r.dedupeKey, r.publishedAt, r.sentiment, r.sentimentScore, r.reach, JSON.stringify(r.tags)],
    );
    inserted.push(...res);
  }
  return inserted;
}

async function newsRows(term: string, subject: string, db: string): Promise<Row[]> {
  const { data } = await searchNews(term, db);
  return data.map((n) => {
      const domain = tryRootDomain(n.publisherUrl ?? "");
      const s = analyzeSentiment(`${n.title}. ${n.snippet}`);
      return {
        subject,
        term,
        source: "google-news" as const,
        channel: "news",
        publisher: n.publisher || domain || "Unknown",
        publisherDomain: domain,
        title: n.title,
        snippet: n.snippet,
        url: n.link,
        publishedAt: n.publishedAt,
        sentiment: s.label,
        sentimentScore: s.score,
        reach: reachEstimate(domain, "news"),
        tags: autoTags(n.title),
        dedupeKey: `${subject}|${n.link.split("?")[0]}`,
      };
    });
}

const DAY = 86400000;
const SOCIAL: { channel: string; weight: number; domain: string; search: (q: string) => string }[] = [
  { channel: "reddit", weight: 0.25, domain: "reddit.com", search: (q) => `https://www.reddit.com/search/?q=${q}` },
  { channel: "x", weight: 0.24, domain: "x.com", search: (q) => `https://x.com/search?q=${q}` },
  { channel: "facebook", weight: 0.12, domain: "facebook.com", search: (q) => `https://www.facebook.com/search/top?q=${q}` },
  { channel: "instagram", weight: 0.1, domain: "instagram.com", search: (q) => `https://www.instagram.com/explore/search/keyword/?q=${q}` },
  { channel: "youtube", weight: 0.09, domain: "youtube.com", search: (q) => `https://www.youtube.com/results?search_query=${q}` },
  { channel: "quora", weight: 0.08, domain: "quora.com", search: (q) => `https://www.quora.com/search?q=${q}` },
  { channel: "forum", weight: 0.07, domain: "", search: (q) => `https://www.google.com/search?q=${q}+forum` },
  { channel: "blog", weight: 0.05, domain: "", search: (q) => `https://www.google.com/search?q=${q}+blog` },
];
const POS = ["Just had a great experience with {brand} — the {aspect} was top notch.", "Shoutout to {brand} for making {topic} so easy.", "{brand} is honestly the best option for {topic} I've found.", "Loved the {aspect} at {brand}! Highly recommend.", "Big thanks to the {brand} team, really helpful and quick to respond."];
const NEU = ["Has anyone tried {brand} for {topic}? Looking for honest opinions.", "{brand} vs {rival} — which one is better for {topic}?", "Does {brand} offer anything for {topic} this year?", "Comparing {topic} options: {brand}, {rival} and a few others.", "Saw {brand} mentioned in a thread about {topic}, what's the deal with them?"];
const NEG = ["Really disappointed with {brand}. The {aspect} was a mess.", "Avoid {brand} if you care about {aspect}. Terrible support.", "Waited weeks for a refund from {brand}, still nothing.", "{brand} keeps ignoring my complaint about the {aspect}.", "Not happy with {brand} — hidden charges and slow replies."];
const ASPECTS = ["customer service", "pricing", "support", "quality", "staff", "process", "communication"];
const HANDLES = ["daily", "real", "the", "just", "its", "hey", "urban", "mr", "ms", "team"];

/** Deterministic demo social/forum mentions for the last 30 days (absolute-date seeded). */
export function demoSocialMentions(project: Pick<Project, "domain" | "competitors" | "brand_terms">, now = Date.now()): Row[] {
  const brand = trackedTerms(project)[0];
  const topic = topicFor(project.domain);
  const rival = defaultCompetitorTerms(project)[0] ?? brandName(topic.leaders[0].split("@")[0]);
  const strength = domainEntity(project.domain).strength;
  const today = Math.floor(now / DAY) * DAY;
  const out: Row[] = [];
  for (let age = 0; age < 30; age++) {
    const day = new Date(today - age * DAY).toISOString().slice(0, 10);
    const r = rng(`bm-demo:${project.domain}:${day}`);
    const count = r.int(0, Math.round(2 + 4 * strength));
    for (let j = 0; j < count; j++) {
      const ch = r.weighted(SOCIAL, SOCIAL.map((c) => c.weight));
      const polarity = r.weighted(["pos", "neu", "neg"] as const, [0.42, 0.4, 0.18]);
      const tpl = r.pick(polarity === "pos" ? POS : polarity === "neg" ? NEG : NEU);
      const title = tpl.replaceAll("{brand}", brand).replaceAll("{topic}", r.pick(topic.heads)).replaceAll("{aspect}", r.pick(ASPECTS)).replaceAll("{rival}", rival);
      const s = analyzeSentiment(title);
      const handle = `${r.pick(HANDLES)}${r.pick(topic.stems)}${r.int(1, 99)}`;
      const publisher = ch.channel === "reddit" ? `r/${topic.stems[0]}${r.pick(["", "advice", "india", "talk"])}` : ch.channel === "x" || ch.channel === "instagram" ? `@${handle}` : ch.channel === "youtube" ? `${titleCase(r.pick(topic.stems))} Reviews` : ch.channel === "forum" ? `${titleCase(r.pick(topic.stems))} Forum` : ch.channel === "blog" ? `${titleCase(r.pick(topic.stems))}${r.pick(["hub", "diaries", "notes"])}.blog` : handle;
      const q = encodeURIComponent(`"${brand}"`);
      out.push({
        subject: "",
        term: brand,
        source: "demo",
        channel: ch.channel,
        publisher,
        publisherDomain: ch.domain || null,
        title,
        snippet: "",
        url: ch.search(q),
        publishedAt: new Date(today - age * DAY + r.int(6, 22) * 3600000 + r.int(0, 59) * 60000).toISOString(),
        sentiment: s.label,
        sentimentScore: s.score,
        reach: Math.round(r.logNormal(ch.channel === "x" ? 2400 : ch.channel === "youtube" ? 5200 : 900, 1.1)),
        tags: autoTags(title),
        dedupeKey: `demo:${day}:${j}`,
      });
    }
  }
  return out.filter((m) => new Date(m.publishedAt).getTime() <= now);
}

/** Fetch new mentions for a project. Returns inserted own-brand mentions and per-term errors. */
export async function ingestMentions(project: Project, settings: BrandSettings, onStep?: (done: number, total: number, message: string) => Promise<void>) {
  const terms = trackedTerms(project);
  const rivals = settings.competitorTerms;
  const total = terms.length + rivals.length + (settings.demoSocial ? 1 : 0);
  const errors: string[] = [];
  const insertedOwn: { sentiment: Sentiment; published_at: Date | string; title: string }[] = [];
  let step = 0;
  for (const term of terms) {
    await onStep?.(step, total, `Searching Google News for “${term}”`);
    try {
      insertedOwn.push(...(await insertMentions(project.id, await newsRows(term, "", project.country))));
    } catch (e) {
      errors.push(`${term}: ${e instanceof Error ? e.message : String(e)}`);
    }
    step++;
  }
  for (const term of rivals) {
    await onStep?.(step, total, `Searching Google News for competitor “${term}”`);
    try {
      await insertMentions(project.id, await newsRows(term, term, project.country));
    } catch (e) {
      errors.push(`${term}: ${e instanceof Error ? e.message : String(e)}`);
    }
    step++;
  }
  if (settings.demoSocial) {
    await onStep?.(step, total, "Adding demo social & forum mentions");
    insertedOwn.push(...(await insertMentions(project.id, demoSocialMentions(project))));
    step++;
  }
  await onStep?.(total, total, "Done");
  return { insertedOwn, errors };
}

// ---------------------------------------------------------------------------------------------- reads

type DbMention = {
  id: string;
  subject: string;
  term: string;
  source: "google-news" | "demo";
  channel: string;
  publisher: string;
  publisher_domain: string | null;
  title: string;
  snippet: string;
  url: string;
  published_at: Date | string;
  sentiment: Sentiment;
  sentiment_score: number;
  reach: number;
  status: MentionStatus;
  tags: string[];
};
const toMention = (r: DbMention): Mention => ({
  id: r.id,
  subject: r.subject,
  term: r.term,
  source: r.source,
  channel: r.channel,
  publisher: r.publisher,
  publisherDomain: r.publisher_domain,
  title: r.title,
  snippet: r.snippet,
  url: r.url,
  publishedAt: new Date(r.published_at).toISOString(),
  sentiment: r.sentiment,
  sentimentScore: Number(r.sentiment_score),
  reach: Number(r.reach),
  status: r.status,
  tags: r.tags,
});

export async function ownMentions(projectId: string, includeDemo: boolean, limit = 2000) {
  const rows = await query<DbMention>(
    `SELECT * FROM bm_mentions WHERE project_id=$1 AND subject='' AND ($2::boolean OR source<>'demo') ORDER BY published_at DESC LIMIT $3`,
    [projectId, includeDemo, limit],
  );
  return rows.map(toMention);
}

export async function shareOfVoice(projectId: string, days = 30) {
  return query<{ subject: string; mentions: number }>(
    `SELECT subject, count(*)::int AS mentions FROM bm_mentions WHERE project_id=$1 AND source='google-news' AND published_at > now() - ($2 * interval '1 day')
     GROUP BY subject ORDER BY mentions DESC`,
    [projectId, days],
  );
}

export async function setMentionStatus(projectId: string, ids: string[], status: MentionStatus) {
  if (!ids.length) return 0;
  const rows = await query("UPDATE bm_mentions SET status=$3 WHERE project_id=$1 AND id = ANY($2::text[]) RETURNING id", [projectId, ids, status]);
  return rows.length;
}
export async function setMentionTags(projectId: string, id: string, tags: string[]) {
  await query("UPDATE bm_mentions SET tags=$3::jsonb WHERE project_id=$1 AND id=$2", [projectId, id, JSON.stringify(tags)]);
}

export function mentionStats(mentions: Mention[], now = Date.now()) {
  const inRange = (m: Mention, from: number, to: number) => {
    const age = now - new Date(m.publishedAt).getTime();
    return age >= from * DAY && age < to * DAY;
  };
  const last30 = mentions.filter((m) => inRange(m, 0, 30));
  const prev30 = mentions.filter((m) => inRange(m, 30, 60));
  const days: { day: string; positive: number; neutral: number; negative: number; total: number }[] = [];
  const today = Math.floor(now / DAY) * DAY;
  const index = new Map<string, (typeof days)[number]>();
  for (let i = 89; i >= 0; i--) {
    const d = { day: new Date(today - i * DAY).toISOString().slice(0, 10), positive: 0, neutral: 0, negative: 0, total: 0 };
    days.push(d);
    index.set(d.day, d);
  }
  for (const m of mentions) {
    const d = index.get(m.publishedAt.slice(0, 10));
    if (d) {
      d[m.sentiment]++;
      d.total++;
    }
  }
  const sources = new Map<string, { publisher: string; domain: string | null; channel: string; source: Mention["source"]; mentions: number; positive: number; negative: number; reach: number }>();
  for (const m of last30.length ? last30 : mentions) {
    const key = `${m.channel}:${m.publisher}`;
    const s = sources.get(key) ?? { publisher: m.publisher, domain: m.publisherDomain, channel: m.channel, source: m.source, mentions: 0, positive: 0, negative: 0, reach: 0 };
    s.mentions++;
    if (m.sentiment === "positive") s.positive++;
    if (m.sentiment === "negative") s.negative++;
    s.reach = Math.max(s.reach, m.reach);
    sources.set(key, s);
  }
  const sentiment = { positive: 0, neutral: 0, negative: 0 } as Record<Sentiment, number>;
  for (const m of last30) sentiment[m.sentiment]++;
  const channels = new Map<string, number>();
  for (const m of last30) channels.set(m.channel, (channels.get(m.channel) ?? 0) + 1);
  return {
    last30: last30.length,
    prev30: prev30.length,
    negative30: sentiment.negative,
    reach30: last30.reduce((s, m) => s + m.reach, 0),
    unreviewed: mentions.filter((m) => m.status === "new").length,
    sentiment,
    days,
    sources: [...sources.values()].sort((a, b) => b.mentions - a.mentions || b.reach - a.reach),
    channels: [...channels.entries()].map(([channel, count]) => ({ channel, label: CHANNELS[channel] ?? channel, count })).sort((a, b) => b.count - a.count),
  };
}
