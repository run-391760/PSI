import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query, transaction } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { CHANNELS } from "@/lib/cx/channels";
import { channelAvailable } from "@/lib/cx/providers";
import { LISTEN_SOURCES, SENTIMENTS, STATUSES, TOPIC_KINDS, parseAppId, parseRule, type ListenSource } from "./sources";
import { DEFAULT_SPIKE_SETTINGS, type SpikeSettings } from "./spikes";
import { isFetchFrequency, normalizeSite, type TopicSpec } from "./topic-query";

/** Server-side data access of the listening module (topics, mentions, settings, tickets from mentions). */

export type Topic = {
  id: string;
  project_id: string;
  name: string;
  kind: "brand" | "competitor" | "campaign" | "industry";
  /** CONTAINS: any of these terms (legacy entries may be rules such as `acme AND (x OR y)`). */
  keywords: string[];
  /** DOES NOT CONTAIN. */
  excluded: string[];
  /** MEDIA PREFERENCE: sources to fetch ([] = every source). */
  sources: ListenSource[];
  languages: string[];
  active: boolean;
  created_at: string;
  app_ids: string[];
  and_contains: string[];
  exclude_authors: string[];
  exclude_sites: string[];
  countries: string[];
  min_followers: number;
  verified_only: boolean;
  fetch_frequency: string;
  objective: string;
  created_by: string | null;
  created_by_name: string | null;
  updated_at: string | null;
  last_fetched_at: string | null;
  mentions: number;
  last_mention: string | null;
};

export async function listTopics(projectId: string): Promise<Topic[]> {
  const rows = await query<Topic>(
    `SELECT t.*, COALESCE(o.app_ids,'[]'::jsonb) app_ids, COALESCE(o.and_contains,'[]'::jsonb) and_contains,
       COALESCE(o.exclude_authors,'[]'::jsonb) exclude_authors, COALESCE(o.exclude_sites,'[]'::jsonb) exclude_sites, COALESCE(o.countries,'[]'::jsonb) countries,
       COALESCE(o.min_followers,0) min_followers, COALESCE(o.verified_only,false) verified_only, COALESCE(o.fetch_frequency,'hourly') fetch_frequency,
       COALESCE(o.objective,'') objective, o.created_by, u.name created_by_name, o.updated_at, o.last_fetched_at,
       (SELECT count(*)::int FROM cx_mentions m WHERE m.topic_id=t.id) mentions,
       (SELECT max(published_at) FROM cx_mentions m WHERE m.topic_id=t.id) last_mention
     FROM cx_topics t LEFT JOIN cx_listening_topic_opts o ON o.topic_id=t.id LEFT JOIN users u ON u.id=o.created_by
     WHERE t.project_id=$1 ORDER BY CASE t.kind WHEN 'brand' THEN 0 WHEN 'competitor' THEN 1 WHEN 'campaign' THEN 2 ELSE 3 END, t.created_at`,
    [projectId],
  );
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return rows.map((r) => ({ ...r, created_at: iso(r.created_at)!, updated_at: iso(r.updated_at), last_fetched_at: iso(r.last_fetched_at), last_mention: iso(r.last_mention) }));
}

/** The matching/query spec of a stored topic (see topic-query.ts). */
export const topicSpec = (t: Pick<Topic, "keywords" | "and_contains" | "excluded" | "exclude_authors" | "exclude_sites" | "countries" | "languages" | "min_followers" | "verified_only">): TopicSpec => ({
  contains: t.keywords ?? [],
  andContains: t.and_contains ?? [],
  excluded: t.excluded ?? [],
  excludeAuthors: t.exclude_authors ?? [],
  excludeSites: t.exclude_sites ?? [],
  countries: t.countries ?? [],
  languages: t.languages ?? [],
  minFollowers: t.min_followers ?? 0,
  verifiedOnly: !!t.verified_only,
});

const list = (max: number, len = 120) => z.array(z.string().trim().max(len)).max(max).transform((a) => [...new Set(a.filter(Boolean))]);
export const topicInput = z.object({
  name: z.string().trim().min(1, "Name the topic.").max(80),
  kind: z.enum(TOPIC_KINDS),
  keywords: list(300, 200).refine((a) => a.length > 0, "Add at least one CONTAINS keyword.").refine((a) => a.every((k) => parseRule(k).length > 0), "A keyword is empty."),
  excluded: list(300, 120),
  sources: z.array(z.enum(LISTEN_SOURCES)).max(LISTEN_SOURCES.length),
  languages: list(15, 5).transform((a) => a.map((l) => l.toLowerCase())),
  appIds: list(5, 20).refine((a) => a.every((x) => parseAppId(x)), "App Store ids look like 1234567890 or gb/1234567890."),
  active: z.boolean().default(true),
  andContains: list(200, 120).optional(),
  excludeAuthors: list(200, 120).optional(),
  excludeSites: list(200, 200).refine((a) => a.every((x) => normalizeSite(x)), "Excluded sites must be domains like example.com.").transform((a) => [...new Set(a.map(normalizeSite))]).optional(),
  countries: list(30, 2).refine((a) => a.every((c) => /^[A-Za-z]{2}$/.test(c)), "Countries are 2-letter codes (IN, US…).").transform((a) => a.map((c) => c.toUpperCase())).optional(),
  minFollowers: z.coerce.number().int().min(0).max(100_000_000).optional(),
  verifiedOnly: z.boolean().optional(),
  fetchFrequency: z.string().refine(isFetchFrequency, "Unknown fetch frequency.").optional(),
  objective: z.string().trim().max(1000).optional(),
});
export type TopicInput = z.input<typeof topicInput>;

export async function saveTopic(projectId: string, input: TopicInput, id?: string, userId?: string | null) {
  const t = topicInput.parse(input);
  const topicId = id ?? randomUUID();
  await transaction(async (q) => {
    if (id) {
      const r = await q("UPDATE cx_topics SET name=$3,kind=$4,keywords=$5::jsonb,excluded=$6::jsonb,sources=$7::jsonb,languages=$8::jsonb,active=$9 WHERE id=$1 AND project_id=$2 RETURNING id", [
        id, projectId, t.name, t.kind, JSON.stringify(t.keywords), JSON.stringify(t.excluded), JSON.stringify(t.sources), JSON.stringify(t.languages), t.active,
      ]);
      if (!r.length) throw new AppError("Topic not found.", 404);
    } else {
      const [{ n }] = await q<{ n: number }>("SELECT count(*)::int n FROM cx_topics WHERE project_id=$1", [projectId]);
      if (n >= 50) throw new AppError("A brand can have up to 50 topics.");
      const [dupe] = await q("SELECT 1 FROM cx_topics WHERE project_id=$1 AND lower(name)=lower($2)", [projectId, t.name]);
      if (dupe) throw new AppError("A topic with that name already exists.");
      await q("INSERT INTO cx_topics(id,project_id,name,kind,keywords,excluded,sources,languages,active) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9)", [
        topicId, projectId, t.name, t.kind, JSON.stringify(t.keywords), JSON.stringify(t.excluded), JSON.stringify(t.sources), JSON.stringify(t.languages), t.active,
      ]);
    }
    // Options: only the fields the caller sent are written, so older callers don't wipe editor settings.
    const opts: [string, unknown, string][] = [["app_ids", JSON.stringify(t.appIds), "::jsonb"]];
    if (t.andContains) opts.push(["and_contains", JSON.stringify(t.andContains), "::jsonb"]);
    if (t.excludeAuthors) opts.push(["exclude_authors", JSON.stringify(t.excludeAuthors), "::jsonb"]);
    if (t.excludeSites) opts.push(["exclude_sites", JSON.stringify(t.excludeSites), "::jsonb"]);
    if (t.countries) opts.push(["countries", JSON.stringify(t.countries), "::jsonb"]);
    if (t.minFollowers !== undefined) opts.push(["min_followers", t.minFollowers, ""]);
    if (t.verifiedOnly !== undefined) opts.push(["verified_only", t.verifiedOnly, ""]);
    if (t.fetchFrequency !== undefined) opts.push(["fetch_frequency", t.fetchFrequency, ""]);
    if (t.objective !== undefined) opts.push(["objective", t.objective, ""]);
    if (!id && userId) opts.push(["created_by", userId, ""]);
    const cols = opts.map((o) => o[0]);
    const vals = opts.map((o, i) => `$${i + 2}${o[2]}`);
    await q(
      `INSERT INTO cx_listening_topic_opts(topic_id,${cols.join(",")},updated_at) VALUES($1,${vals.join(",")},now())
       ON CONFLICT(topic_id) DO UPDATE SET ${cols.filter((c) => c !== "created_by").map((c) => `${c}=excluded.${c}`).join(",")}, updated_at=now()`,
      [topicId, ...opts.map((o) => o[1])],
    );
  });
  return topicId;
}

/** Copy a topic (name gets a "(copy)" suffix; starts paused so it doesn't double-fetch until reviewed). */
export async function duplicateTopic(projectId: string, id: string, userId: string | null) {
  const t = (await listTopics(projectId)).find((x) => x.id === id);
  if (!t) throw new AppError("Topic not found.", 404);
  const names = new Set((await listTopics(projectId)).map((x) => x.name.toLowerCase()));
  let name = `${t.name} (copy)`.slice(0, 80);
  for (let i = 2; names.has(name.toLowerCase()); i++) name = `${t.name} (copy ${i})`.slice(0, 80);
  return saveTopic(projectId, {
    name, kind: t.kind, keywords: t.keywords, excluded: t.excluded, sources: t.sources, languages: t.languages, appIds: t.app_ids, active: false,
    andContains: t.and_contains, excludeAuthors: t.exclude_authors, excludeSites: t.exclude_sites, countries: t.countries, minFollowers: t.min_followers,
    verifiedOnly: t.verified_only, fetchFrequency: t.fetch_frequency, objective: t.objective,
  }, undefined, userId);
}

export async function markTopicFetched(topicId: string) {
  await query("INSERT INTO cx_listening_topic_opts(topic_id,last_fetched_at) VALUES($1,now()) ON CONFLICT(topic_id) DO UPDATE SET last_fetched_at=now()", [topicId]);
}

export async function deleteTopic(projectId: string, id: string) {
  await query("DELETE FROM cx_topics WHERE id=$1 AND project_id=$2", [id, projectId]);
}

export async function setTopicActive(projectId: string, id: string, active: boolean) {
  await query("UPDATE cx_topics SET active=$3 WHERE id=$1 AND project_id=$2", [id, projectId, active]);
}

// ------------------------------------------------------------------ settings

export type FetchReport = { at: string; sources: Record<string, { fetched: number; inserted: number; error?: string; skipped?: string }>; inserted: number };
export type ListeningSettings = SpikeSettings & {
  escalationOwner: string;
  notify: boolean;
  firstFetchAt: string | null;
  lastFetchAt: string | null;
  lastFetch: FetchReport | Record<string, never>;
  lastDetectAt: string | null;
  lastDetect: Record<string, unknown>;
};

export async function getSettings(projectId: string): Promise<ListeningSettings> {
  const [r] = await query<Record<string, any>>("SELECT * FROM cx_listening_settings WHERE project_id=$1", [projectId]);
  if (!r) return { ...DEFAULT_SPIKE_SETTINGS, escalationOwner: "", notify: true, firstFetchAt: null, lastFetchAt: null, lastFetch: {}, lastDetectAt: null, lastDetect: {} };
  return {
    volumeZ: Number(r.volume_z),
    negativeZ: Number(r.negative_z),
    minMentions: r.min_mentions,
    baselineDays: r.baseline_days,
    windowHours: r.window_hours,
    escalationOwner: r.escalation_owner,
    notify: r.notify,
    firstFetchAt: r.first_fetch_at,
    lastFetchAt: r.last_fetch_at,
    lastFetch: r.last_fetch ?? {},
    lastDetectAt: r.last_detect_at,
    lastDetect: r.last_detect ?? {},
  };
}

export const settingsInput = z.object({
  volumeZ: z.coerce.number().min(1).max(10),
  negativeZ: z.coerce.number().min(1).max(10),
  minMentions: z.coerce.number().int().min(1).max(10000),
  baselineDays: z.coerce.number().int().min(3).max(60),
  windowHours: z.coerce.number().int().refine((v) => [1, 3, 6, 12, 24].includes(v), "Window must be 1, 3, 6, 12 or 24 hours."),
  escalationOwner: z.string().trim().max(120),
  notify: z.boolean(),
});

export async function saveSettings(projectId: string, input: z.input<typeof settingsInput>) {
  const s = settingsInput.parse(input);
  if ((s.baselineDays * 24) / s.windowHours > 1500) throw new AppError("Baseline too long for this window size.");
  await query(
    `INSERT INTO cx_listening_settings(project_id,volume_z,negative_z,min_mentions,baseline_days,window_hours,escalation_owner,notify) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT(project_id) DO UPDATE SET volume_z=$2,negative_z=$3,min_mentions=$4,baseline_days=$5,window_hours=$6,escalation_owner=$7,notify=$8`,
    [projectId, s.volumeZ, s.negativeZ, s.minMentions, s.baselineDays, s.windowHours, s.escalationOwner, s.notify],
  );
}

// ------------------------------------------------------------------ sources

export type SourceStatus = { source: ListenSource; name: string; available: boolean; api: string; costNote: string; env: string[]; setup: string };
export function sourceStatuses(): SourceStatus[] {
  return LISTEN_SOURCES.map((s) => {
    const c = CHANNELS.find((x) => x.kind === s);
    return { source: s, name: c?.name ?? s, available: channelAvailable(s), api: c?.api ?? "", costNote: c?.costNote ?? "", env: c?.env ?? [], setup: c?.setup ?? "" };
  });
}

// ------------------------------------------------------------------ mentions

export type Mention = {
  id: string;
  topic_id: string | null;
  topic_name: string | null;
  topic_kind: string | null;
  source: string;
  external_id: string;
  url: string | null;
  author: string;
  author_handle: string | null;
  author_followers: number | null;
  title: string;
  body: string;
  language: string | null;
  /** English translation of an Indian-language mention (Sarvam AI). */
  translation: string | null;
  country: string | null;
  published_at: string | null;
  sentiment: string | null;
  sentiment_score: number | null;
  intent: string | null;
  engagement: Record<string, number>;
  status: "new" | "read" | "actioned" | "ignored";
  tags: string[];
  ticket_id: string | null;
  ticket_number: number | null;
  fetched_at: string;
};

export type MentionFilters = { topic?: string; source?: string; sentiment?: string; intent?: string; lang?: string; status?: string; q?: string; from?: string; to?: string; tag?: string };

export function readFilters(sp: Record<string, string | string[] | undefined>): MentionFilters {
  const g = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string).slice(0, 200) : undefined);
  return { topic: g("topic"), source: g("source"), sentiment: g("sentiment"), intent: g("intent"), lang: g("lang"), status: g("status"), q: g("q"), from: g("from"), to: g("to"), tag: g("tag") };
}

function where(projectId: string, f: MentionFilters) {
  const params: unknown[] = [projectId];
  const conds = ["m.project_id=$1"];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    conds.push(sql.replaceAll("?", `$${params.length}`));
  };
  if (f.topic) add("m.topic_id=?", f.topic);
  if (f.source) add("m.source=?", f.source);
  if (f.sentiment && (SENTIMENTS as readonly string[]).includes(f.sentiment)) add("m.sentiment=?", f.sentiment);
  if (f.intent) add("m.intent=?", f.intent);
  if (f.lang) add("m.language=?", f.lang);
  if (f.status === "open") conds.push("m.status IN ('new','read')");
  else if (f.status && (STATUSES as readonly string[]).includes(f.status)) add("m.status=?", f.status);
  if (f.tag) add("m.tags @> ?::jsonb", JSON.stringify([f.tag]));
  if (f.q) add("(m.title ILIKE ? OR m.body ILIKE ? OR m.author ILIKE ? OR m.translation ILIKE ?)", `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) add("m.published_at >= ?::date", f.from);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) add("m.published_at < ?::date + 1", f.to);
  return { sql: conds.join(" AND "), params };
}

export async function listMentions(projectId: string, f: MentionFilters, page = 1, pageSize = 50) {
  const w = where(projectId, f);
  const [{ n }] = await query<{ n: number }>(`SELECT count(*)::int n FROM cx_mentions m WHERE ${w.sql}`, w.params);
  const rows = await query<Mention>(
    `SELECT m.*, t.name topic_name, t.kind topic_kind, k.number ticket_number FROM cx_mentions m
     LEFT JOIN cx_topics t ON t.id=m.topic_id LEFT JOIN cx_tickets k ON k.id=m.ticket_id
     WHERE ${w.sql} ORDER BY m.published_at DESC NULLS LAST, m.fetched_at DESC LIMIT ${pageSize} OFFSET ${(Math.max(1, page) - 1) * pageSize}`,
    w.params,
  );
  return { total: n, rows };
}

export async function mentionFacets(projectId: string) {
  const [counts] = await query<{ total: number; unread: number; negative_open: number }>(
    "SELECT count(*)::int total, count(*) FILTER (WHERE status='new')::int unread, count(*) FILTER (WHERE status IN ('new','read') AND sentiment='negative')::int negative_open FROM cx_mentions WHERE project_id=$1",
    [projectId],
  );
  const langs = await query<{ language: string; n: number }>("SELECT language, count(*)::int n FROM cx_mentions WHERE project_id=$1 AND language IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 20", [projectId]);
  const tags = await query<{ tag: string; n: number }>("SELECT t tag, count(*)::int n FROM cx_mentions, jsonb_array_elements_text(tags) t WHERE project_id=$1 GROUP BY 1 ORDER BY 2 DESC LIMIT 30", [projectId]);
  return { ...counts, languages: langs.map((l) => l.language), tags: tags.map((t) => t.tag) };
}

/** All mentions for export (capped). */
export async function exportMentions(projectId: string, f: MentionFilters, limit = 10000) {
  const w = where(projectId, f);
  return query<Mention>(`SELECT m.*, t.name topic_name, t.kind topic_kind, NULL::int ticket_number FROM cx_mentions m LEFT JOIN cx_topics t ON t.id=m.topic_id WHERE ${w.sql} ORDER BY m.published_at DESC NULLS LAST LIMIT ${limit}`, w.params);
}

export const bulkInput = z.object({
  ids: z.array(z.string().max(64)).min(1).max(500),
  op: z.enum(["read", "new", "ignored", "actioned", "tag", "untag"]),
  tag: z.string().trim().max(40).optional(),
});
export async function bulkUpdate(projectId: string, input: z.input<typeof bulkInput>) {
  const b = bulkInput.parse(input);
  if (b.op === "tag" || b.op === "untag") {
    if (!b.tag) throw new AppError("Enter a tag.");
    const sql =
      b.op === "tag"
        ? "UPDATE cx_mentions SET tags = CASE WHEN tags @> $3::jsonb THEN tags ELSE tags || $3::jsonb END WHERE project_id=$1 AND id = ANY($2)"
        : "UPDATE cx_mentions SET tags = tags - $3 WHERE project_id=$1 AND id = ANY($2)";
    await query(sql, [projectId, b.ids, b.op === "tag" ? JSON.stringify([b.tag]) : b.tag]);
  } else await query("UPDATE cx_mentions SET status=$3 WHERE project_id=$1 AND id = ANY($2)", [projectId, b.ids, b.op]);
  return b.ids.length;
}

export async function updateMentionLabels(projectId: string, id: string, patch: { sentiment?: string; intent?: string }) {
  if (patch.sentiment && !(SENTIMENTS as readonly string[]).includes(patch.sentiment)) throw new AppError("Invalid sentiment.");
  if (patch.intent && !/^[a-z_]{2,20}$/.test(patch.intent)) throw new AppError("Invalid intent.");
  await query("UPDATE cx_mentions SET sentiment=COALESCE($3,sentiment), intent=COALESCE($4,intent), status=CASE WHEN status='new' THEN 'read' ELSE status END WHERE id=$1 AND project_id=$2", [
    id, projectId, patch.sentiment ?? null, patch.intent ?? null,
  ]);
}

/** Turn a mention into an inbox ticket: contact (by source handle) + ticket + first inbound message. */
export async function createTicketFromMention(projectId: string, mentionId: string) {
  return transaction(async (q) => {
    const [m] = await q<Mention>("SELECT * FROM cx_mentions WHERE id=$1 AND project_id=$2", [mentionId, projectId]);
    if (!m) throw new AppError("Mention not found.", 404);
    if (m.ticket_id) {
      const [t] = await q<{ id: string; number: number }>("SELECT id, number FROM cx_tickets WHERE id=$1", [m.ticket_id]);
      if (t) return { ticketId: t.id, number: t.number, existing: true };
    }
    const handle = m.author_handle ?? m.author;
    let [contact] = await q<{ id: string }>("SELECT id FROM cx_contacts WHERE project_id=$1 AND handles->>$2 = $3 LIMIT 1", [projectId, m.source, handle]);
    if (!contact) {
      contact = { id: randomUUID() };
      await q("INSERT INTO cx_contacts(id,project_id,name,handles,attributes,tags) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)", [
        contact.id,
        projectId,
        m.author || handle,
        JSON.stringify({ [m.source]: handle }),
        JSON.stringify(m.author_followers != null ? { followers: m.author_followers } : {}),
        JSON.stringify(["listening"]),
      ]);
    } else await q("UPDATE cx_contacts SET last_seen=now() WHERE id=$1", [contact.id]);
    const [{ n }] = await q<{ n: number }>("SELECT COALESCE(MAX(number),0)+1 n FROM cx_tickets WHERE project_id=$1", [projectId]);
    const id = randomUUID();
    const subject = (m.title || m.body).replace(/\s+/g, " ").slice(0, 120) || `Mention by ${m.author}`;
    const priority = m.sentiment === "negative" && ["complaint", "cancellation"].includes(m.intent ?? "") ? "high" : "normal";
    await q(
      `INSERT INTO cx_tickets(id,project_id,number,subject,status,priority,channel_kind,contact_id,tags,sentiment,intent,language,external_thread_id)
       VALUES($1,$2,$3,$4,'new',$5,$6,$7,$8::jsonb,$9,$10,$11,$12)`,
      [id, projectId, n, subject, priority, m.source, contact.id, JSON.stringify(["listening", ...m.tags].slice(0, 10)), m.sentiment, m.intent, m.language, m.external_id],
    );
    const body = [m.title, m.body, m.url].filter(Boolean).join("\n\n");
    await q("INSERT INTO cx_messages(id,ticket_id,direction,author_name,body,external_id,created_at) VALUES($1,$2,'in',$3,$4,$5,COALESCE($6::timestamptz,now()))", [
      randomUUID(), id, m.author, body, m.external_id, m.published_at,
    ]);
    await q("UPDATE cx_mentions SET ticket_id=$2, status='actioned' WHERE id=$1", [m.id, id]);
    return { ticketId: id, number: n, existing: false };
  });
}
