import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { analyzeText } from "@/lib/cx/ai";
import type { Project } from "@/lib/projects";
import { fetchSource, type RawMention } from "./connectors";
import { listTopics, markTopicFetched, sourceStatuses, topicSpec, type FetchReport, type Topic } from "./data";
import { LISTEN_SOURCES, STRICT_MATCH, isExcluded, type ListenSource } from "./sources";
import { isDue, matchesSpec, rejectReason } from "./topic-query";

type TopicLike = Pick<Topic, "keywords" | "excluded" | "languages"> & Partial<Pick<Topic, "and_contains" | "exclude_authors" | "exclude_sites" | "countries" | "min_followers" | "verified_only">>;

/**
 * Filter a source's raw results against a topic and analyze them: CONTAINS (strict sources only; other
 * engines matched the full article server-side), AND CONTAINS (strict sources), DOES NOT CONTAIN (always),
 * excluded authors/sites, languages, countries, minimum followers and verified-only (see topic-query.ts).
 */
export function prepareMentions(raw: RawMention[], topic: TopicLike, source: ListenSource, opts: { keepAll?: boolean } = {}) {
  const spec = topicSpec({ and_contains: [], exclude_authors: [], exclude_sites: [], countries: [], min_followers: 0, verified_only: false, ...topic });
  const seen = new Set<string>();
  return raw.flatMap((r) => {
    if (seen.has(r.externalId)) return [];
    seen.add(r.externalId);
    const text = `${r.title} ${r.body}`.trim();
    if (!text) return [];
    if (!opts.keepAll && (STRICT_MATCH[source] ? !matchesSpec(text, spec) : isExcluded(text, spec.excluded))) return [];
    const a = analyzeText(text);
    const language = r.language ?? a.language;
    if (rejectReason({ ...r, language, site: source === "news" ? r.authorHandle : null }, spec)) return [];
    // Star ratings are a stronger sentiment signal than the lexicon for reviews.
    const rating = r.engagement.rating;
    const sentiment = rating == null ? a.sentiment : rating <= 2 ? "negative" : rating >= 4 ? "positive" : "neutral";
    return [{ ...r, language, sentiment, sentimentScore: a.sentimentScore, intent: a.intent }];
  });
}

/** Store analyzed mentions (deduped per source id); returns ids and how many were new. */
export async function storeMentions(projectId: string, topicId: string | null, source: string, rows: ReturnType<typeof prepareMentions>) {
  let inserted = 0;
  const ids: string[] = [];
  for (const r of rows) {
    const res = await query(
      `INSERT INTO cx_mentions(id,project_id,topic_id,source,external_id,url,author,author_handle,author_followers,title,body,language,country,published_at,sentiment,sentiment_score,intent,engagement)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)
       ON CONFLICT(project_id,source,external_id) DO UPDATE SET engagement=excluded.engagement, author_followers=COALESCE(excluded.author_followers, cx_mentions.author_followers), topic_id=COALESCE(cx_mentions.topic_id, excluded.topic_id)
       RETURNING id, (xmax = 0) inserted`,
      [
        randomUUID(), projectId, topicId, source, r.externalId.slice(0, 500), r.url, r.author.slice(0, 200), r.authorHandle, r.authorFollowers,
        r.title.slice(0, 500), r.body.slice(0, 8000), r.language, r.country, r.publishedAt, r.sentiment, r.sentimentScore, r.intent, JSON.stringify(r.engagement),
      ],
    );
    const row = res[0] as { id?: string; inserted?: boolean } | undefined;
    if (row?.inserted) inserted++;
    if (row?.id) ids.push(row.id);
    if (row?.id && r.media?.length)
      await query("INSERT INTO cx_listening_media(mention_id,project_id,media) VALUES($1,$2,$3::jsonb) ON CONFLICT(mention_id) DO UPDATE SET media=excluded.media", [row.id, projectId, JSON.stringify(r.media.slice(0, 8))]);
  }
  return { inserted, ids };
}

/**
 * Fetch every active, due topic from its preferred sources and store new mentions, then the brand's tracked
 * public profiles (More Social Profiles). Paused topics are skipped (no data accumulates); topics whose fetch
 * frequency hasn't elapsed are skipped unless the run is manual.
 */
export async function ingestBrand(project: Project, progress: (done: number, total: number, message: string) => Promise<void>, cancelled: () => Promise<boolean> = async () => false, opts: { manual?: boolean } = {}) {
  const now = new Date();
  const topics = (await listTopics(project.id)).filter((t) => t.active && isDue(t.fetch_frequency, t.last_fetched_at, now, opts.manual));
  const available = new Set(sourceStatuses().filter((s) => s.available).map((s) => s.source));
  const plan = topics.flatMap((t) => (t.sources.length ? t.sources : [...LISTEN_SOURCES]).map((s) => ({ topic: t, source: s })));
  const report: FetchReport = { at: new Date().toISOString(), sources: {}, inserted: 0 };
  const bump = (s: string, patch: { fetched?: number; inserted?: number; error?: string; skipped?: string }) => {
    const r = (report.sources[s] ??= { fetched: 0, inserted: 0 });
    r.fetched += patch.fetched ?? 0;
    r.inserted += patch.inserted ?? 0;
    if (patch.error) r.error = r.error ? `${r.error}; ${patch.error}` : patch.error;
    if (patch.skipped && !r.error) r.skipped = patch.skipped;
  };
  let done = 0;
  for (const { topic, source } of plan) {
    if (await cancelled()) break;
    await progress(done, plan.length, `${topic.name}: ${source}`);
    done++;
    if (!available.has(source)) {
      bump(source, { skipped: "not configured" });
      continue;
    }
    if (source === "google-reviews" && topic.kind !== "brand") {
      bump(source, { skipped: "brand topics only" });
      continue;
    }
    if (source === "appstore" && !topic.app_ids.length) {
      bump(source, { skipped: "no App Store ids" });
      continue;
    }
    try {
      const raw = await fetchSource(source, { keywords: topic.keywords, excluded: topic.excluded, appIds: topic.app_ids, country: project.country || "US", language: project.language || "en", spec: topicSpec(topic), brand: { projectId: project.id, ownerId: project.owner_id, country: project.country || "US" }, topicKind: topic.kind, cancelled });
      const rows = prepareMentions(raw, topic, source);
      const { inserted } = await storeMentions(project.id, topic.id, source, rows);
      bump(source, { fetched: rows.length, inserted });
      report.inserted += inserted;
    } catch (e) {
      bump(source, { error: `${topic.name}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) });
    }
  }
  for (const t of topics) await markTopicFetched(t.id);
  if (!(await cancelled())) {
    const { ingestSocialProfiles } = await import("@/lib/cx/admin/social-profiles");
    const p = await ingestSocialProfiles(project.id).catch((e) => ({ inserted: 0, profiles: 0, error: e instanceof Error ? e.message : String(e) }));
    if (p.profiles || "error" in p) bump("profiles", { fetched: p.profiles, inserted: p.inserted, error: "error" in p ? String(p.error).slice(0, 200) : undefined });
    report.inserted += p.inserted;
  }
  await progress(plan.length, plan.length, `Stored ${report.inserted} new mentions`);
  await query(
    `INSERT INTO cx_listening_settings(project_id, first_fetch_at, last_fetch_at, last_fetch) VALUES($1, now(), now(), $2::jsonb)
     ON CONFLICT(project_id) DO UPDATE SET first_fetch_at=COALESCE(cx_listening_settings.first_fetch_at, now()), last_fetch_at=now(), last_fetch=$2::jsonb`,
    [project.id, JSON.stringify(report)],
  );
  return { ...report, topics: topics.length };
}
