import { randomUUID } from "node:crypto";
import { query, transaction, type Query } from "@/lib/db";
import { AppError, database, normalizeKeywords } from "@/lib/domain";
import { keywordRows } from "./metrics";
import { autoGroup, crossGroupNegatives, type AdMatch, type CampaignDetail, type PpcCampaign, type PpcCampaignSummary, type PpcGroup, type PpcNegative } from "./ppc-model";

export const MAX_CAMPAIGN_KEYWORDS = 5000;
const MATCHES: AdMatch[] = ["broad", "phrase", "exact"];
const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());
const asMatch = (m: unknown): AdMatch => (MATCHES.includes(m as AdMatch) ? (m as AdMatch) : "broad");

function cleanName(name: string, what = "Name") {
  const n = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!n) throw new AppError(`${what} is required.`);
  if (n.length > 80) throw new AppError(`${what} can be at most 80 characters.`);
  return n;
}

type CampaignRow = { id: string; name: string; db: string; ctr: number; created_at: Date | string; updated_at: Date | string };
const toCampaign = (r: CampaignRow): PpcCampaign => ({ id: r.id, name: r.name, db: r.db, ctr: Number(r.ctr), created_at: iso(r.created_at), updated_at: iso(r.updated_at) });

export async function listCampaigns(ownerId: string): Promise<PpcCampaignSummary[]> {
  const rows = await query<CampaignRow & { groups: number; keywords: number; volume: number }>(
    `SELECT c.*, (SELECT count(*)::int FROM kw_ppc_groups g WHERE g.campaign_id=c.id) AS groups,
       (SELECT count(*)::int FROM kw_ppc_keywords k WHERE k.campaign_id=c.id) AS keywords,
       (SELECT COALESCE(sum(k.volume),0)::float8 FROM kw_ppc_keywords k WHERE k.campaign_id=c.id) AS volume
     FROM kw_ppc_campaigns c WHERE c.owner_id=$1 ORDER BY c.updated_at DESC`,
    [ownerId],
  );
  return rows.map((r) => ({ ...toCampaign(r), groups: Number(r.groups), keywords: Number(r.keywords), volume: Number(r.volume) }));
}

async function ownCampaign(ownerId: string, id: string) {
  const [row] = await query<CampaignRow>("SELECT * FROM kw_ppc_campaigns WHERE id=$1 AND owner_id=$2", [id, ownerId]);
  if (!row) throw new AppError("Campaign not found.", 404);
  return toCampaign(row);
}
async function ownGroup(campaignId: string, groupId: string) {
  const [row] = await query<{ id: string }>("SELECT id FROM kw_ppc_groups WHERE id=$1 AND campaign_id=$2", [groupId, campaignId]);
  if (!row) throw new AppError("Ad group not found.", 404);
}
const touch = (q: Query, id: string) => q("UPDATE kw_ppc_campaigns SET updated_at=now() WHERE id=$1", [id]);

export async function getCampaign(ownerId: string, id: string): Promise<CampaignDetail> {
  const campaign = await ownCampaign(ownerId, id);
  const groups = await query<{ id: string; name: string }>("SELECT id,name FROM kw_ppc_groups WHERE campaign_id=$1 ORDER BY (name LIKE '%(general)'), created_at, name", [id]);
  const kws = await query<{ id: string; group_id: string; keyword: string; match_type: string; volume: number | null; cpc: number | null; competition: number | null; metrics_source: string }>(
    "SELECT * FROM kw_ppc_keywords WHERE campaign_id=$1 ORDER BY volume DESC NULLS LAST, keyword",
    [id],
  );
  const negs = await query<{ id: string; group_id: string | null; keyword: string; match_type: string; origin: string }>("SELECT * FROM kw_ppc_negatives WHERE campaign_id=$1 ORDER BY origin DESC, keyword", [id]);
  const round2 = (v: number | null) => (v == null ? null : Math.round(Number(v) * 100) / 100);
  const byGroup = new Map<string, PpcGroup>(groups.map((g) => [g.id, { id: g.id, name: g.name, keywords: [], negatives: [] }]));
  for (const k of kws)
    byGroup.get(k.group_id)?.keywords.push({ id: k.id, groupId: k.group_id, keyword: k.keyword, match: asMatch(k.match_type), volume: k.volume, cpc: round2(k.cpc), competition: round2(k.competition), source: k.metrics_source });
  const campaignNegatives: PpcNegative[] = [];
  for (const n of negs) {
    const neg: PpcNegative = { id: n.id, groupId: n.group_id, keyword: n.keyword, match: asMatch(n.match_type), origin: n.origin === "cross-group" ? "cross-group" : "manual" };
    if (n.group_id) byGroup.get(n.group_id)?.negatives.push(neg);
    else campaignNegatives.push(neg);
  }
  return { campaign, groups: [...byGroup.values()], campaignNegatives };
}

async function insertKeywords(q: Query, ownerId: string, campaign: PpcCampaign, groupId: string, keywords: string[], match: AdMatch) {
  if (!keywords.length) return 0;
  const { data, source } = await keywordRows(ownerId, keywords, campaign.db);
  let added = 0;
  for (let i = 0; i < data.length; i += 100) {
    const chunk = data.slice(i, i + 100);
    const params: unknown[] = [];
    const values = chunk.map((r) => {
      const b = params.length;
      params.push(randomUUID(), campaign.id, groupId, r.keyword, match, r.volume, r.cpc, r.competition, source);
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`;
    });
    const rows = await q(`INSERT INTO kw_ppc_keywords(id,campaign_id,group_id,keyword,match_type,volume,cpc,competition,metrics_source) VALUES ${values.join(",")} ON CONFLICT(group_id,keyword) DO NOTHING RETURNING id`, params);
    added += rows.length;
  }
  return added;
}

async function countKeywords(campaignId: string) {
  const [{ n }] = await query<{ n: number }>("SELECT count(*)::int AS n FROM kw_ppc_keywords WHERE campaign_id=$1", [campaignId]);
  return Number(n);
}

export async function createCampaign(ownerId: string, input: { name: string; db: string; keywords?: string[]; autoGroup?: boolean; match?: AdMatch }) {
  const [{ n }] = await query<{ n: number }>("SELECT count(*)::int AS n FROM kw_ppc_campaigns WHERE owner_id=$1", [ownerId]);
  if (n >= 50) throw new AppError("You can have at most 50 campaigns. Delete one first.");
  const keywords = input.keywords?.length ? normalizeKeywords(input.keywords, MAX_CAMPAIGN_KEYWORDS) : [];
  const id = randomUUID();
  const campaign: PpcCampaign = { id, name: cleanName(input.name, "Campaign name"), db: database(input.db).code, ctr: 0.035, created_at: "", updated_at: "" };
  const groups = keywords.length ? (input.autoGroup === false ? [{ name: "Ad group 1", keywords }] : autoGroup(keywords)) : [{ name: "Ad group 1", keywords: [] }];
  await transaction(async (q) => {
    await q("INSERT INTO kw_ppc_campaigns(id,owner_id,name,db) VALUES($1,$2,$3,$4)", [id, ownerId, campaign.name, campaign.db]);
    for (const g of groups) {
      const gid = randomUUID();
      await q("INSERT INTO kw_ppc_groups(id,campaign_id,name) VALUES($1,$2,$3)", [gid, id, g.name.slice(0, 80)]);
      await insertKeywords(q, ownerId, campaign, gid, g.keywords, asMatch(input.match));
    }
  });
  return id;
}

export async function updateCampaign(ownerId: string, id: string, input: { name?: string; ctr?: number }) {
  const c = await ownCampaign(ownerId, id);
  const ctr = input.ctr == null ? c.ctr : Number(input.ctr);
  if (!(ctr >= 0.001 && ctr <= 0.5)) throw new AppError("CTR must be between 0.1% and 50%.");
  await query("UPDATE kw_ppc_campaigns SET name=$3, ctr=$4, updated_at=now() WHERE id=$1 AND owner_id=$2", [id, ownerId, input.name == null ? c.name : cleanName(input.name, "Campaign name"), ctr]);
}

export async function deleteCampaign(ownerId: string, id: string) {
  await ownCampaign(ownerId, id);
  await query("DELETE FROM kw_ppc_campaigns WHERE id=$1 AND owner_id=$2", [id, ownerId]);
}

export async function addGroup(ownerId: string, campaignId: string, name: string) {
  await ownCampaign(ownerId, campaignId);
  const [{ n }] = await query<{ n: number }>("SELECT count(*)::int AS n FROM kw_ppc_groups WHERE campaign_id=$1", [campaignId]);
  if (n >= 200) throw new AppError("A campaign can have at most 200 ad groups.");
  const id = randomUUID();
  await transaction(async (q) => {
    await q("INSERT INTO kw_ppc_groups(id,campaign_id,name) VALUES($1,$2,$3)", [id, campaignId, cleanName(name, "Ad group name")]);
    await touch(q, campaignId);
  });
  return id;
}

export async function renameGroup(ownerId: string, campaignId: string, groupId: string, name: string) {
  await ownCampaign(ownerId, campaignId);
  await ownGroup(campaignId, groupId);
  await query("UPDATE kw_ppc_groups SET name=$2 WHERE id=$1", [groupId, cleanName(name, "Ad group name")]);
}

export async function deleteGroup(ownerId: string, campaignId: string, groupId: string) {
  await ownCampaign(ownerId, campaignId);
  await ownGroup(campaignId, groupId);
  await transaction(async (q) => {
    await q("DELETE FROM kw_ppc_groups WHERE id=$1", [groupId]);
    await touch(q, campaignId);
  });
}

export async function addKeywords(ownerId: string, campaignId: string, groupId: string, keywordsInput: string[], match: AdMatch) {
  const campaign = await ownCampaign(ownerId, campaignId);
  await ownGroup(campaignId, groupId);
  const keywords = normalizeKeywords(keywordsInput, MAX_CAMPAIGN_KEYWORDS);
  if (!keywords.length) throw new AppError("Add at least one keyword.");
  if ((await countKeywords(campaignId)) + keywords.length > MAX_CAMPAIGN_KEYWORDS) throw new AppError(`A campaign holds at most ${MAX_CAMPAIGN_KEYWORDS.toLocaleString()} keywords.`);
  return transaction(async (q) => {
    const added = await insertKeywords(q, ownerId, campaign, groupId, keywords, asMatch(match));
    await touch(q, campaignId);
    return { added, skipped: keywords.length - added };
  });
}

const idsJson = (ids: string[]) => JSON.stringify(ids.map(String).slice(0, 5000));

export async function updateKeywords(ownerId: string, campaignId: string, ids: string[], change: { match?: AdMatch; groupId?: string }) {
  await ownCampaign(ownerId, campaignId);
  if (change.groupId) await ownGroup(campaignId, change.groupId);
  await transaction(async (q) => {
    if (change.match) await q("UPDATE kw_ppc_keywords SET match_type=$3 WHERE campaign_id=$1 AND id IN (SELECT jsonb_array_elements_text($2::jsonb))", [campaignId, idsJson(ids), asMatch(change.match)]);
    if (change.groupId)
      // Moving into a group that already has the keyword: drop the moved duplicate.
      await q(
        `DELETE FROM kw_ppc_keywords k WHERE k.campaign_id=$1 AND k.id IN (SELECT jsonb_array_elements_text($2::jsonb))
         AND EXISTS (SELECT 1 FROM kw_ppc_keywords o WHERE o.group_id=$3 AND o.keyword=k.keyword AND o.id<>k.id)`,
        [campaignId, idsJson(ids), change.groupId],
      ).then(() => q("UPDATE kw_ppc_keywords SET group_id=$3 WHERE campaign_id=$1 AND id IN (SELECT jsonb_array_elements_text($2::jsonb))", [campaignId, idsJson(ids), change.groupId]));
    await touch(q, campaignId);
  });
}

export async function removeKeywords(ownerId: string, campaignId: string, ids: string[]) {
  await ownCampaign(ownerId, campaignId);
  await transaction(async (q) => {
    await q("DELETE FROM kw_ppc_keywords WHERE campaign_id=$1 AND id IN (SELECT jsonb_array_elements_text($2::jsonb))", [campaignId, idsJson(ids)]);
    await touch(q, campaignId);
  });
}

export async function addNegatives(ownerId: string, campaignId: string, groupId: string | null, keywordsInput: string[], match: AdMatch) {
  await ownCampaign(ownerId, campaignId);
  if (groupId) await ownGroup(campaignId, groupId);
  const keywords = normalizeKeywords(keywordsInput, 1000);
  if (!keywords.length) throw new AppError("Enter at least one negative keyword.");
  return transaction(async (q) => {
    let added = 0;
    for (const k of keywords) {
      const rows = await q("INSERT INTO kw_ppc_negatives(id,campaign_id,group_id,keyword,match_type,origin) VALUES($1,$2,$3,$4,$5,'manual') ON CONFLICT DO NOTHING RETURNING id", [randomUUID(), campaignId, groupId, k, asMatch(match)]);
      added += rows.length;
    }
    await touch(q, campaignId);
    return { added };
  });
}

export async function removeNegatives(ownerId: string, campaignId: string, ids: string[]) {
  await ownCampaign(ownerId, campaignId);
  await query("DELETE FROM kw_ppc_negatives WHERE campaign_id=$1 AND id IN (SELECT jsonb_array_elements_text($2::jsonb))", [campaignId, idsJson(ids)]);
}

/** Re-creates ad groups from all campaign keywords by common words (keeps match types and metrics). */
export async function regroupCampaign(ownerId: string, campaignId: string) {
  const d = await getCampaign(ownerId, campaignId);
  const all = d.groups.flatMap((g) => g.keywords);
  if (all.length < 3) throw new AppError("Add at least 3 keywords before auto-grouping.");
  const byKeyword = new Map(all.map((k) => [k.keyword, k]));
  const groups = autoGroup([...byKeyword.keys()]);
  await transaction(async (q) => {
    await q("DELETE FROM kw_ppc_negatives WHERE campaign_id=$1 AND origin='cross-group'", [campaignId]);
    const oldGroups = d.groups.map((g) => g.id);
    for (const g of groups) {
      const gid = randomUUID();
      await q("INSERT INTO kw_ppc_groups(id,campaign_id,name) VALUES($1,$2,$3)", [gid, campaignId, g.name.slice(0, 80)]);
      for (let i = 0; i < g.keywords.length; i += 100) {
        const params: unknown[] = [];
        const values = g.keywords.slice(i, i + 100).map((kw) => {
          const k = byKeyword.get(kw)!;
          const b = params.length;
          params.push(randomUUID(), campaignId, gid, k.keyword, k.match, k.volume, k.cpc, k.competition, k.source);
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`;
        });
        await q(`INSERT INTO kw_ppc_keywords(id,campaign_id,group_id,keyword,match_type,volume,cpc,competition,metrics_source) VALUES ${values.join(",")}`, params);
      }
    }
    // Manual negatives on old groups are kept as campaign-level negatives.
    await q("UPDATE kw_ppc_negatives SET group_id=NULL WHERE campaign_id=$1 AND group_id IN (SELECT jsonb_array_elements_text($2::jsonb)) AND NOT EXISTS (SELECT 1 FROM kw_ppc_negatives n2 WHERE n2.campaign_id=$1 AND n2.group_id IS NULL AND n2.keyword=kw_ppc_negatives.keyword AND n2.match_type=kw_ppc_negatives.match_type)", [campaignId, JSON.stringify(oldGroups)]);
    await q("DELETE FROM kw_ppc_groups WHERE campaign_id=$1 AND id IN (SELECT jsonb_array_elements_text($2::jsonb))", [campaignId, JSON.stringify(oldGroups)]);
    await touch(q, campaignId);
  });
  return groups.length;
}

/** Replaces the automatic cross-group negatives. */
export async function applyCrossNegatives(ownerId: string, campaignId: string) {
  const d = await getCampaign(ownerId, campaignId);
  const negs = crossGroupNegatives(d.groups);
  await transaction(async (q) => {
    await q("DELETE FROM kw_ppc_negatives WHERE campaign_id=$1 AND origin='cross-group'", [campaignId]);
    for (const n of negs)
      await q("INSERT INTO kw_ppc_negatives(id,campaign_id,group_id,keyword,match_type,origin) VALUES($1,$2,$3,$4,$5,'cross-group') ON CONFLICT DO NOTHING", [randomUUID(), campaignId, n.groupId, n.keyword, n.match]);
    await touch(q, campaignId);
  });
  return negs.length;
}

/** Keeps each keyword in one ad group only (the group whose name it matches, else the first). */
export async function removeDuplicates(ownerId: string, campaignId: string) {
  const d = await getCampaign(ownerId, campaignId);
  const seen = new Map<string, { id: string; score: number }>();
  const drop: string[] = [];
  for (const g of d.groups) {
    const gname = g.name.toLowerCase();
    for (const k of g.keywords) {
      const score = gname.split(/\s+/).some((w) => w.length > 2 && k.keyword.includes(w)) ? 1 : 0;
      const prev = seen.get(k.keyword);
      if (!prev) seen.set(k.keyword, { id: k.id, score });
      else if (score > prev.score) {
        drop.push(prev.id);
        seen.set(k.keyword, { id: k.id, score });
      } else drop.push(k.id);
    }
  }
  if (drop.length) await removeKeywords(ownerId, campaignId, drop);
  return drop.length;
}
