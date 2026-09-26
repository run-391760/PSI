import { domainFacts, domainKeywords, memo, paidKeywordRows } from "@/lib/seo/engine";
import { database } from "@/lib/domain";
import { dfs, market } from "@/lib/providers/dataforseo";
import { cached, demo, liveEnabled, type Sourced } from "@/lib/providers/source";
import type { Intent } from "@/lib/seo/types";
import { KEYWORD_GAP_CATEGORIES, keywordGapCategories, type KeywordGapCategory } from "./gap-logic";

export type GapType = "organic" | "paid";

export type GapKeyword = {
  keyword: string;
  volume: number;
  kd: number;
  cpc: number;
  competition: number;
  intents: Intent[];
  /** Position of each domain (same order as `domains`); null = not ranking. */
  positions: (number | null)[];
};

export type GapDomain = { domain: string; sampleKeywords: number; totalKeywords: number | null; traffic: number | null };

export type KeywordGapReport = {
  db: string;
  type: GapType;
  domains: GapDomain[];
  rows: GapKeyword[];
  counts: Record<KeywordGapCategory, number>;
  /** overlap[i][j] = keywords both domain i and j rank for. */
  overlap: number[][];
  /** Keywords every domain ranks for. */
  sharedByAll: number;
};

const MAX_ROWS = 6000;

type Entry = { metrics: Omit<GapKeyword, "keyword" | "positions">; position: number };

function assemble(db: string, type: GapType, domains: GapDomain[], maps: Map<string, Entry>[]): KeywordGapReport {
  const union = new Map<string, GapKeyword>();
  maps.forEach((m, i) => {
    for (const [keyword, e] of m) {
      let row = union.get(keyword);
      if (!row) {
        row = { keyword, ...e.metrics, positions: domains.map(() => null) };
        union.set(keyword, row);
      }
      row.positions[i] = e.position;
    }
  });
  const rows = [...union.values()].sort((a, b) => b.volume - a.volume).slice(0, MAX_ROWS);
  const counts = Object.fromEntries(KEYWORD_GAP_CATEGORIES.map((c) => [c.id, 0])) as Record<KeywordGapCategory, number>;
  const overlap = domains.map(() => domains.map(() => 0));
  let sharedByAll = 0;
  for (const r of rows) {
    for (const c of keywordGapCategories(r.positions)) counts[c]++;
    const idx = r.positions.flatMap((p, i) => (p != null ? [i] : []));
    for (const i of idx) for (const j of idx) overlap[i][j]++;
    if (idx.length === domains.length) sharedByAll++;
  }
  return { db, type, domains, rows, counts, overlap, sharedByAll };
}

const demoGap = memo((list: string[], db: string, type: GapType): KeywordGapReport => {
  const maps = list.map((d) => {
    const m = new Map<string, Entry>();
    if (type === "organic")
      for (const k of domainKeywords(d, db))
        m.set(k.keyword, { position: k.position, metrics: { volume: k.metrics.volume, kd: k.metrics.kd, cpc: k.metrics.cpc, competition: k.metrics.competition, intents: k.metrics.intents } });
    else
      for (const k of paidKeywordRows(d, db))
        m.set(k.keyword, { position: k.position, metrics: { volume: k.metrics.volume, kd: k.metrics.kd, cpc: k.metrics.cpc, competition: k.metrics.competition, intents: k.metrics.intents } });
    return m;
  });
  const domains = list.map((d, i) => {
    const f = domainFacts(d, db);
    return {
      domain: d,
      sampleKeywords: maps[i].size,
      totalKeywords: type === "organic" ? f.organicKeywords : f.paidKeywords,
      traffic: type === "organic" ? f.organicTraffic : f.paidTraffic,
    };
  });
  return assemble(db, type, domains, maps);
}, 30);

/* eslint-disable @typescript-eslint/no-explicit-any */
async function liveGap(ownerId: string, list: string[], db: string, type: GapType): Promise<KeywordGapReport> {
  const results = await Promise.all(
    list.map((d) =>
      dfs(ownerId, "dataforseo_labs/google/ranked_keywords/live", { target: d, ...market(db), limit: 1000, item_types: [type], order_by: ["keyword_data.keyword_info.search_volume,desc"] }, 110000).then((r) => r[0]),
    ),
  );
  const maps = results.map((res: any) => {
    const m = new Map<string, Entry>();
    for (const it of (res?.items ?? []) as any[]) {
      const kd = it.keyword_data ?? {};
      if (!kd.keyword) continue;
      m.set(String(kd.keyword), {
        position: it.ranked_serp_element?.serp_item?.rank_group ?? 0,
        metrics: {
          volume: kd.keyword_info?.search_volume ?? 0,
          kd: kd.keyword_properties?.keyword_difficulty ?? 0,
          cpc: kd.keyword_info?.cpc ?? 0,
          competition: kd.keyword_info?.competition ?? 0,
          intents: [kd.search_intent_info?.main_intent].filter(Boolean) as Intent[],
        },
      });
    }
    return m;
  });
  const domains = list.map((d, i) => ({ domain: d, sampleKeywords: maps[i].size, totalKeywords: (results[i] as any)?.total_count ?? null, traffic: null }));
  return assemble(db, type, domains, maps);
}

export async function getKeywordGap(ownerId: string, list: string[], dbInput: string, type: GapType): Promise<Sourced<KeywordGapReport>> {
  const db = database(dbInput).code;
  if (liveEnabled()) return cached(`keyword-gap:${type}:${db}:${list.join(",")}`, "dataforseo", 24 * 7, () => liveGap(ownerId, list, db, type));
  return demo(demoGap(list, db, type));
}
