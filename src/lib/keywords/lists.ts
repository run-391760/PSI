import { randomUUID } from "node:crypto";
import { query, transaction } from "@/lib/db";
import { AppError, database, normalizeKeywords } from "@/lib/domain";
import type { Intent, SerpFeature } from "@/lib/seo/types";
import { keywordRows } from "./metrics";
import type { KeywordList, KwRow, ListItem } from "./types";

export const MAX_LIST_KEYWORDS = 2000;
export const MAX_LISTS = 100;

type ListRow = { id: string; name: string; db: string; keywords: number; volume: number; avg_kd: number | null; created_at: Date | string; updated_at: Date | string };
const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

function toList(r: ListRow): KeywordList {
  return { id: r.id, name: r.name, db: r.db, keywords: Number(r.keywords), volume: Number(r.volume), avgKd: r.avg_kd == null ? null : Math.round(Number(r.avg_kd)), created_at: iso(r.created_at), updated_at: iso(r.updated_at) };
}

const LIST_SELECT = `SELECT l.id, l.name, l.db, l.created_at, l.updated_at, count(i.keyword)::int AS keywords,
  COALESCE(sum(i.volume),0)::float8 AS volume, avg(i.kd)::float8 AS avg_kd
  FROM kw_lists l LEFT JOIN kw_list_items i ON i.list_id=l.id`;

export async function listLists(ownerId: string) {
  const rows = await query<ListRow>(`${LIST_SELECT} WHERE l.owner_id=$1 GROUP BY l.id ORDER BY l.updated_at DESC`, [ownerId]);
  return rows.map(toList);
}

/** Owner-scoped fetch; throws 404 for lists the user does not own. */
export async function getList(ownerId: string, id: string) {
  const [row] = await query<ListRow>(`${LIST_SELECT} WHERE l.id=$1 AND l.owner_id=$2 GROUP BY l.id`, [id, ownerId]);
  if (!row) throw new AppError("Keyword list not found.", 404);
  return toList(row);
}

function cleanName(name: string) {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) throw new AppError("Give the list a name.");
  if (n.length > 80) throw new AppError("List names can be at most 80 characters.");
  return n;
}

export async function createList(ownerId: string, name: string, db: string) {
  const [{ n }] = await query<{ n: number }>("SELECT count(*)::int AS n FROM kw_lists WHERE owner_id=$1", [ownerId]);
  if (n >= MAX_LISTS) throw new AppError(`You can have at most ${MAX_LISTS} keyword lists. Delete one first.`);
  const id = randomUUID();
  await query("INSERT INTO kw_lists(id,owner_id,name,db) VALUES($1,$2,$3,$4)", [id, ownerId, cleanName(name), database(db).code]);
  return id;
}

export async function renameList(ownerId: string, id: string, name: string) {
  await getList(ownerId, id);
  await query("UPDATE kw_lists SET name=$3, updated_at=now() WHERE id=$1 AND owner_id=$2", [id, ownerId, cleanName(name)]);
}

export async function deleteList(ownerId: string, id: string) {
  await getList(ownerId, id);
  await query("DELETE FROM kw_lists WHERE id=$1 AND owner_id=$2", [id, ownerId]);
}

type ItemRow = {
  keyword: string;
  volume: number | null;
  kd: number | null;
  cpc: number | null;
  competition: number | null;
  intents: Intent[];
  serp_features: SerpFeature[];
  trend: number[];
  results: string | number | null;
  metrics_source: string;
  added_from: string;
  added_at: Date | string;
  metrics_at: Date | string;
};

export async function listItems(ownerId: string, id: string): Promise<ListItem[]> {
  await getList(ownerId, id);
  const rows = await query<ItemRow>("SELECT * FROM kw_list_items WHERE list_id=$1 ORDER BY volume DESC NULLS LAST, keyword", [id]);
  return rows.map((r) => ({
    keyword: r.keyword,
    volume: r.volume,
    kd: r.kd,
    cpc: r.cpc == null ? null : Math.round(Number(r.cpc) * 100) / 100,
    competition: r.competition == null ? null : Math.round(Number(r.competition) * 100) / 100,
    intents: r.intents ?? [],
    features: r.serp_features ?? [],
    trend: r.trend ?? [],
    results: r.results == null ? null : Number(r.results),
    source: r.metrics_source,
    addedFrom: r.added_from,
    addedAt: iso(r.added_at),
    metricsAt: iso(r.metrics_at),
  }));
}

async function upsertRows(listId: string, rows: KwRow[], source: string, addedFrom: string, refresh: boolean) {
  await transaction(async (q) => {
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const params: unknown[] = [];
      const values = chunk.map((r) => {
        const b = params.length;
        params.push(listId, r.keyword, r.volume, r.kd, r.cpc, r.competition, JSON.stringify(r.intents), JSON.stringify(r.features), JSON.stringify(r.trend), r.results, source, addedFrom);
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7}::jsonb,$${b + 8}::jsonb,$${b + 9}::jsonb,$${b + 10},$${b + 11},$${b + 12})`;
      });
      await q(
        `INSERT INTO kw_list_items(list_id,keyword,volume,kd,cpc,competition,intents,serp_features,trend,results,metrics_source,added_from)
         VALUES ${values.join(",")}
         ON CONFLICT(list_id,keyword) DO ${refresh ? "UPDATE SET volume=excluded.volume,kd=excluded.kd,cpc=excluded.cpc,competition=excluded.competition,intents=excluded.intents,serp_features=excluded.serp_features,trend=excluded.trend,results=excluded.results,metrics_source=excluded.metrics_source,metrics_at=now()" : "NOTHING"}`,
        params,
      );
    }
    await q("UPDATE kw_lists SET updated_at=now() WHERE id=$1", [listId]);
  });
}

/** Adds keywords (metrics fetched now). Existing keywords are skipped. */
export async function addToList(ownerId: string, id: string, keywordsInput: string[], addedFrom = "manual") {
  const list = await getList(ownerId, id);
  const keywords = normalizeKeywords(keywordsInput, MAX_LIST_KEYWORDS);
  if (!keywords.length) throw new AppError("Add at least one keyword.");
  const existing = new Set((await query<{ keyword: string }>("SELECT keyword FROM kw_list_items WHERE list_id=$1", [id])).map((r) => r.keyword));
  const fresh = keywords.filter((k) => !existing.has(k));
  if (list.keywords + fresh.length > MAX_LIST_KEYWORDS)
    throw new AppError(`A list holds at most ${MAX_LIST_KEYWORDS.toLocaleString()} keywords; this one has ${list.keywords.toLocaleString()}. Add fewer keywords or create another list.`);
  if (fresh.length) {
    const { data, source } = await keywordRows(ownerId, fresh, list.db);
    await upsertRows(id, data, source, addedFrom.slice(0, 40), false);
  }
  return { added: fresh.length, skipped: keywords.length - fresh.length };
}

export async function removeFromList(ownerId: string, id: string, keywords: string[]) {
  await getList(ownerId, id);
  if (!keywords.length) return 0;
  const rows = await query("DELETE FROM kw_list_items WHERE list_id=$1 AND keyword IN (SELECT jsonb_array_elements_text($2::jsonb)) RETURNING keyword", [id, JSON.stringify(keywords)]);
  await query("UPDATE kw_lists SET updated_at=now() WHERE id=$1", [id]);
  return rows.length;
}

/** Re-fetches metrics for every keyword in the list. */
export async function refreshList(ownerId: string, id: string) {
  const list = await getList(ownerId, id);
  const keywords = (await query<{ keyword: string }>("SELECT keyword FROM kw_list_items WHERE list_id=$1", [id])).map((r) => r.keyword);
  if (!keywords.length) return 0;
  const { data, source } = await keywordRows(ownerId, keywords, list.db);
  await upsertRows(id, data, source, "manual", true);
  return keywords.length;
}
