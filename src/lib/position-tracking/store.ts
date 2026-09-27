import { randomUUID } from "node:crypto";
import { query, transaction, type Query } from "@/lib/db";
import { AppError, database, normalizeKeywords, rootDomain } from "@/lib/domain";
import { demoAllowed } from "@/lib/data-mode";
import { keywordMetrics } from "@/lib/seo/engine";
import { liveEnabled } from "@/lib/providers/source";
import { linkedGscSite } from "./gsc";
import type { Intent } from "@/lib/seo/types";
import { MAX_COMPETITORS, MAX_KEYWORDS, type Campaign, type CampaignSource, type DeviceMode, type KeywordEntry, type Tag, type TrackedKeyword } from "./types";

type CampaignRow = {
  project_id: string;
  engine: string;
  db: string;
  location: string;
  device: DeviceMode;
  competitors: string[];
  source: string;
  created_at: string | Date;
  updated_at: string | Date;
  last_check_at: string | Date | null;
  first_day: string | null;
  last_day: string | null;
};
const iso = (d: string | Date | null) => (d == null ? null : new Date(d).toISOString());

function toCampaign(r: CampaignRow): Campaign {
  return {
    projectId: r.project_id,
    engine: "google",
    db: r.db,
    location: r.location,
    device: r.device,
    competitors: r.competitors ?? [],
    source: r.source === "dataforseo" || r.source === "search-console" ? r.source : "demo",
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    lastCheckAt: iso(r.last_check_at),
    firstDay: r.first_day,
    lastDay: r.last_day,
  };
}

export async function getCampaign(projectId: string) {
  const [row] = await query<CampaignRow>("SELECT * FROM pt_campaigns WHERE project_id=$1", [projectId]);
  return row ? toCampaign(row) : null;
}

/** Campaign status per project for the project gate. */
export async function campaignsByOwner(ownerId: string) {
  const rows = await query<{ project_id: string; keywords: number; last_check_at: string | null }>(
    `SELECT c.project_id, c.last_check_at, (SELECT count(*)::int FROM pt_keywords k WHERE k.project_id=c.project_id) AS keywords
     FROM pt_campaigns c JOIN projects p ON p.id=c.project_id WHERE p.owner_id=$1`,
    [ownerId],
  );
  return new Map(rows.map((r) => [r.project_id, { keywords: r.keywords, lastCheckAt: iso(r.last_check_at) }]));
}

export async function listKeywords(projectId: string): Promise<TrackedKeyword[]> {
  const rows = await query<{ id: string; keyword: string; volume: number | null; cpc: number | null; kd: number | null; intents: Intent[]; created_at: string; tags: { id: string; name: string }[] }>(
    `SELECT k.id, k.keyword, k.volume, k.cpc, k.kd, k.intents, k.created_at,
       COALESCE((SELECT json_agg(json_build_object('id',t.id,'name',t.name) ORDER BY t.name) FROM pt_keyword_tags kt JOIN pt_tags t ON t.id=kt.tag_id WHERE kt.keyword_id=k.id), '[]'::json) AS tags
     FROM pt_keywords k WHERE k.project_id=$1 ORDER BY k.created_at, k.keyword`,
    [projectId],
  );
  return rows.map((r) => ({ id: r.id, keyword: r.keyword, volume: r.volume, cpc: r.cpc, kd: r.kd, intents: r.intents ?? [], tags: r.tags ?? [], createdAt: iso(r.created_at)! }));
}

export async function listTags(projectId: string): Promise<Tag[]> {
  const rows = await query<{ id: string; name: string; created_at: string; keywords: number }>(
    `SELECT t.id, t.name, t.created_at, (SELECT count(*)::int FROM pt_keyword_tags kt WHERE kt.tag_id=t.id) AS keywords
     FROM pt_tags t WHERE t.project_id=$1 ORDER BY t.name`,
    [projectId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, keywords: r.keywords, createdAt: iso(r.created_at)! }));
}

// ------------------------------------------------------------------------------------ Validation

export function cleanTagName(name: string) {
  const t = name.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!t) throw new AppError("Tag name is required.");
  if (t.length > 40) throw new AppError("Tag names can be at most 40 characters.");
  return t;
}

export function cleanCompetitors(list: string[], ownDomain: string) {
  const out: string[] = [];
  for (const raw of list.map((s) => s.trim()).filter(Boolean)) {
    let d: string;
    try {
      d = rootDomain(raw);
    } catch {
      throw new AppError(`“${raw}” is not a valid competitor domain.`);
    }
    if (d === ownDomain || out.includes(d)) continue;
    out.push(d);
  }
  if (out.length > MAX_COMPETITORS) throw new AppError(`Track at most ${MAX_COMPETITORS} competitors.`);
  return out;
}

/** Normalizes keyword entries, merging tags of duplicates. */
export function cleanEntries(entries: KeywordEntry[]) {
  const keywords = normalizeKeywords(entries.map((e) => e.keyword), MAX_KEYWORDS);
  const tags = new Map<string, Set<string>>();
  for (const e of entries) {
    const k = normalizeKeywords([e.keyword])[0];
    if (!k) continue;
    const set = tags.get(k) ?? new Set<string>();
    for (const t of e.tags ?? []) if (t.trim()) set.add(cleanTagName(t));
    tags.set(k, set);
  }
  return keywords.map((k) => ({ keyword: k, tags: [...(tags.get(k) ?? [])] }));
}

// ------------------------------------------------------------------------------------ Mutations

async function ensureTags(q: Query, projectId: string, names: string[]) {
  const ids = new Map<string, string>();
  for (const name of new Set(names)) {
    const [row] = await q<{ id: string }>(
      `INSERT INTO pt_tags(id,project_id,name) VALUES($1,$2,$3) ON CONFLICT(project_id,name) DO UPDATE SET name=excluded.name RETURNING id`,
      [randomUUID(), projectId, name],
    );
    ids.set(name, row.id);
  }
  return ids;
}

/** Inserts keywords (skipping existing ones) and assigns tags. Returns ids of new keywords. */
export async function insertKeywords(q: Query, projectId: string, db: string, source: string, entries: { keyword: string; tags: string[] }[]) {
  const tagIds = await ensureTags(q, projectId, entries.flatMap((e) => e.tags));
  const inserted: string[] = [];
  const rows = entries.map((e) => {
    const m = source === "demo" && demoAllowed() ? keywordMetrics(e.keyword, db) : null;
    return { id: randomUUID(), project_id: projectId, keyword: e.keyword, volume: m?.volume ?? null, cpc: m?.cpc ?? null, kd: m?.kd ?? null, intents: m?.intents ?? [], metrics_source: m ? "demo" : "pending" };
  });
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await q<{ id: string; keyword: string }>(
      `INSERT INTO pt_keywords(id,project_id,keyword,volume,cpc,kd,intents,metrics_source)
       SELECT x.id,x.project_id,x.keyword,x.volume,x.cpc,x.kd,x.intents,x.metrics_source
       FROM jsonb_to_recordset($1::jsonb) AS x(id text, project_id text, keyword text, volume int, cpc real, kd int, intents jsonb, metrics_source text)
       ON CONFLICT(project_id,keyword) DO NOTHING RETURNING id, keyword`,
      [JSON.stringify(chunk)],
    );
    inserted.push(...res.map((r) => r.id));
  }
  // Tag assignment also applies to keywords that already existed.
  const links: { keyword_id: string; tag_id: string }[] = [];
  const withTags = entries.filter((e) => e.tags.length);
  if (withTags.length) {
    const idRows = await q<{ id: string; keyword: string }>(
      "SELECT id, keyword FROM pt_keywords WHERE project_id=$1 AND keyword IN (SELECT jsonb_array_elements_text($2::jsonb))",
      [projectId, JSON.stringify(withTags.map((e) => e.keyword))],
    );
    const byKeyword = new Map(idRows.map((r) => [r.keyword, r.id]));
    for (const e of withTags) for (const t of e.tags) links.push({ keyword_id: byKeyword.get(e.keyword)!, tag_id: tagIds.get(t)! });
    await q(
      `INSERT INTO pt_keyword_tags(keyword_id,tag_id) SELECT x.keyword_id,x.tag_id FROM jsonb_to_recordset($1::jsonb) AS x(keyword_id text, tag_id text) ON CONFLICT DO NOTHING`,
      [JSON.stringify(links.filter((l) => l.keyword_id && l.tag_id))],
    );
  }
  return inserted;
}

export async function keywordCount(projectId: string) {
  const [row] = await query<{ n: number }>("SELECT count(*)::int AS n FROM pt_keywords WHERE project_id=$1", [projectId]);
  return row.n;
}

export async function createCampaign(
  project: { id: string; domain: string },
  input: { db: string; location: string; device: DeviceMode; competitors: string[]; keywords: KeywordEntry[]; source?: CampaignSource | null },
) {
  const db = database(input.db).code;
  const location = input.location.trim().slice(0, 120);
  if (!["desktop", "mobile", "both"].includes(input.device)) throw new AppError("Choose a device.");
  const competitors = cleanCompetitors(input.competitors, project.domain);
  const entries = cleanEntries(input.keywords);
  if (!entries.length) throw new AppError("Add at least one keyword to track.");
  const available = await availableSources(project.id);
  const source = input.source && available.includes(input.source) ? input.source : available[0];
  if (!source) throw new AppError("Link a Search Console property to this project or connect DataForSEO first.");
  await transaction(async (q) => {
    const created = await q(
      `INSERT INTO pt_campaigns(project_id,db,location,device,competitors,source) VALUES($1,$2,$3,$4,$5::jsonb,$6)
       ON CONFLICT(project_id) DO NOTHING RETURNING project_id`,
      [project.id, db, location, input.device, JSON.stringify(competitors), source],
    );
    if (!created.length) throw new AppError("Position Tracking is already set up for this project.", 409);
    await insertKeywords(q, project.id, db, source, entries);
  });
  return getCampaign(project.id);
}

/**
 * Data sources a new campaign can use, best first: Search Console (the project's linked property; real
 * average positions of your own site), DataForSEO (live SERPs incl. competitors), demo only with DEMO_DATA=true.
 */
export async function availableSources(projectId: string): Promise<CampaignSource[]> {
  const out: CampaignSource[] = [];
  if (await linkedGscSite(projectId)) out.push("search-console");
  if (liveEnabled()) out.push("dataforseo");
  if (demoAllowed()) out.push("demo");
  return out;
}

export async function updateCampaign(projectId: string, patch: Partial<{ db: string; location: string; device: DeviceMode; competitors: string[]; source: string }>) {
  const current = await getCampaign(projectId);
  if (!current) throw new AppError("Set up Position Tracking first.", 404);
  await query(
    `UPDATE pt_campaigns SET db=$2, location=$3, device=$4, competitors=$5::jsonb, source=$6, updated_at=now() WHERE project_id=$1`,
    [
      projectId,
      patch.db ?? current.db,
      patch.location ?? current.location,
      patch.device ?? current.device,
      JSON.stringify(patch.competitors ?? current.competitors),
      patch.source ?? current.source,
    ],
  );
  return (await getCampaign(projectId))!;
}

/** Removes all collected history (used when targeting changes so old and new data never mix). */
export async function clearHistory(projectId: string) {
  await transaction(async (q) => {
    await q("DELETE FROM pt_rankings WHERE project_id=$1", [projectId]);
    await q("DELETE FROM pt_serps WHERE project_id=$1", [projectId]);
    await q("DELETE FROM pt_daily WHERE project_id=$1", [projectId]);
    await q("UPDATE pt_campaigns SET first_day=NULL, last_day=NULL, last_check_at=NULL WHERE project_id=$1", [projectId]);
  });
}

export async function deleteCampaign(projectId: string) {
  await transaction(async (q) => {
    await q("DELETE FROM pt_alert_rules WHERE project_id=$1", [projectId]);
    await q("DELETE FROM pt_daily WHERE project_id=$1", [projectId]);
    await q("DELETE FROM pt_keywords WHERE project_id=$1", [projectId]);
    await q("DELETE FROM pt_tags WHERE project_id=$1", [projectId]);
    await q("DELETE FROM pt_campaigns WHERE project_id=$1", [projectId]);
    await q("DELETE FROM schedules WHERE project_id=$1 AND kind='position-tracking.check'", [projectId]);
  });
}
