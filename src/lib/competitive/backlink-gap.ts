import { domainEntity, domainFacts, memo, referringDomains } from "@/lib/seo/engine";
import { dfs } from "@/lib/providers/dataforseo";
import { cached, demo as demoData, liveEnabled, type Sourced } from "@/lib/providers/source";
import { demoAllowed } from "@/lib/data-mode";
import { AppError } from "@/lib/domain";
import { BACKLINK_GAP_CATEGORIES, backlinkGapCategories, type BacklinkGapCategory } from "./gap-logic";

export type BacklinkGapRow = {
  domain: string;
  authorityScore: number | null;
  /** Backlinks from this referring domain to each target (same order as targets); 0 = none. */
  counts: number[];
  /** How many targets it links to. */
  matches: number;
  country: string;
};

export type BacklinkGapTarget = { domain: string; authorityScore: number | null; referringDomains: number | null; backlinks: number | null; sample: number };

export type BacklinkGapReport = {
  targets: BacklinkGapTarget[];
  rows: BacklinkGapRow[];
  counts: Record<BacklinkGapCategory, number>;
  overlap: number[][];
  sharedByAll: number;
  /** Monthly referring domains per target: { month, t0, t1… }. */
  trend: Record<string, string | number>[];
};

type Link = { domain: string; authorityScore: number | null; backlinks: number; country: string };

function assemble(targets: BacklinkGapTarget[], lists: Link[][], trend: BacklinkGapReport["trend"]): BacklinkGapReport {
  const union = new Map<string, BacklinkGapRow>();
  const own = new Set(targets.map((t) => t.domain));
  lists.forEach((list, i) => {
    for (const l of list) {
      if (own.has(l.domain)) continue;
      let row = union.get(l.domain);
      if (!row) {
        row = { domain: l.domain, authorityScore: l.authorityScore, counts: targets.map(() => 0), matches: 0, country: l.country };
        union.set(l.domain, row);
      }
      row.counts[i] = Math.max(1, l.backlinks);
    }
  });
  const rows = [...union.values()];
  const counts = Object.fromEntries(BACKLINK_GAP_CATEGORIES.map((c) => [c.id, 0])) as Record<BacklinkGapCategory, number>;
  const overlap = targets.map(() => targets.map(() => 0));
  let sharedByAll = 0;
  for (const r of rows) {
    r.matches = r.counts.filter((c) => c > 0).length;
    for (const c of backlinkGapCategories(r.counts)) counts[c]++;
    const idx = r.counts.flatMap((c, i) => (c > 0 ? [i] : []));
    for (const i of idx) for (const j of idx) overlap[i][j]++;
    if (idx.length === targets.length) sharedByAll++;
  }
  rows.sort((a, b) => (b.authorityScore ?? 0) - (a.authorityScore ?? 0) || b.matches - a.matches);
  return { targets, rows, counts, overlap, sharedByAll, trend };
}

const demoGap = memo((list: string[]): BacklinkGapReport => {
  const facts = list.map((d) => domainFacts(d, domainEntity(d).homeDb));
  const lists = list.map((d) => referringDomains(d).map((r) => ({ domain: r.domain, authorityScore: r.authorityScore, backlinks: r.backlinks, country: r.country })));
  const targets = list.map((d, i) => ({ domain: d, authorityScore: facts[i].authorityScore, referringDomains: facts[i].referringDomains, backlinks: facts[i].backlinks, sample: lists[i].length }));
  const trend = facts[0].history.map((h, m) => {
    const row: Record<string, string | number> = { month: h.month };
    facts.forEach((f, i) => (row[`t${i}`] = f.history[m]?.referringDomains ?? 0));
    return row;
  });
  return assemble(targets, lists, trend);
}, 30);

/* eslint-disable @typescript-eslint/no-explicit-any */
async function liveGap(ownerId: string, list: string[]): Promise<BacklinkGapReport> {
  const from = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 23, 1)).toISOString().slice(0, 10);
  const per = await Promise.all(
    list.map(async (d) => {
      const [refs] = await dfs(ownerId, "backlinks/referring_domains/live", { target: d, limit: 1000, order_by: ["rank,desc"] }, 60000);
      const [summary] = await dfs(ownerId, "backlinks/summary/live", { target: d, include_subdomains: true }, 30000).catch(() => [undefined]);
      const [history] = await dfs(ownerId, "backlinks/history/live", { target: d, date_from: from }, 30000).catch(() => [undefined]);
      return { refs, summary, history };
    }),
  );
  const lists: Link[][] = per.map(({ refs }) =>
    ((refs?.items ?? []) as any[]).map((it) => ({ domain: String(it.domain ?? ""), authorityScore: it.rank != null ? Math.round(it.rank / 10) : null, backlinks: it.backlinks ?? 1, country: "" })).filter((l) => l.domain),
  );
  const targets = list.map((d, i) => {
    const s: any = per[i].summary ?? {};
    return { domain: d, authorityScore: s.rank != null ? Math.round(s.rank / 10) : null, referringDomains: s.referring_domains ?? null, backlinks: s.backlinks ?? null, sample: lists[i].length };
  });
  const months = new Map<string, Record<string, string | number>>();
  per.forEach(({ history }, i) => {
    for (const h of (history?.items ?? []) as any[]) {
      const month = String(h.date ?? "").slice(0, 7);
      if (!month) continue;
      const row = months.get(month) ?? { month };
      row[`t${i}`] = h.referring_domains ?? 0;
      months.set(month, row);
    }
  });
  const trend = [...months.values()].sort((a, b) => String(a.month).localeCompare(String(b.month)));
  return assemble(targets, lists, trend);
}

export async function getBacklinkGap(ownerId: string, list: string[]): Promise<Sourced<BacklinkGapReport>> {
  if (liveEnabled()) return cached(`backlink-gap:${list.join(",")}`, "dataforseo", 24 * 7, () => liveGap(ownerId, list));
  return demo(demoGap(list));
}

/** Demo data only in local development (DEMO_DATA=true). */
function demo<T>(data: T, note?: string): Sourced<T> {
  if (!demoAllowed()) throw new AppError("Backlink Gap needs DataForSEO.", 409);
  return demoData(data, note);
}
