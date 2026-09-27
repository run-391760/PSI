import type { DataSource } from "@/lib/providers/labels";

/**
 * Pure SERP-volatility math for the SERP Sensor (no database or provider imports, unit-tested in
 * tests/platform-real.test.ts). Two real bases:
 *  - Personal score: the user's own Position Tracking daily positions (pt_rankings).
 *  - Market score: daily top-10 Google snapshots of a fixed keyword panel fetched from DataForSEO.
 * Both are on a 0–10 scale (0 calm, 10 heavy turbulence).
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

// ------------------------------------------------------------------------------------------ personal

export type PersonalScore = {
  /** Where positions came from: Position Tracking's stored daily rankings, or the demo engine (DEMO_DATA only). */
  basis: "rankings" | "engine";
  source: DataSource;
  keywords: number;
  projects: { id: string; name: string; domain: string; keywords: number }[];
  series: { date: string; score: number }[];
  today: number;
  change: number;
  avg30: number;
  movers: { keyword: string; domain: string; from: number | null; to: number | null }[];
};

export type RankRow = { project_id: string; keyword: string; device: string; day: string; pos: string | number | null; source: string };
type ProjectRef = { id: string; name: string; domain: string };

/**
 * Personal volatility from stored daily positions. Per keyword × device, the day-over-day absolute
 * rank change (capped at 20; entering/leaving the tracked range counts 12) is averaged over all
 * keywords measured on both days and scaled ×2.4 to the 0–10 scale.
 */
export function personalFromRows(rows: RankRow[], dates: string[], projects: ProjectRef[]): PersonalScore | null {
  if (!rows.length) return null;
  const byKey = new Map<string, Map<string, number | null>>();
  for (const r of rows) {
    const key = `${r.project_id}|${r.device}|${r.keyword}`;
    const m = byKey.get(key) ?? new Map<string, number | null>();
    const n = r.pos == null || r.pos === "" ? null : Number(r.pos);
    m.set(r.day, n != null && Number.isFinite(n) && n > 0 ? n : null);
    byKey.set(key, m);
  }
  const series = dates.slice(1).map((date, i) => {
    let sum = 0;
    let n = 0;
    for (const m of byKey.values()) {
      if (!m.has(date) || !m.has(dates[i])) continue;
      const a = m.get(dates[i]) ?? null;
      const b = m.get(date) ?? null;
      if (a == null && b == null) continue;
      sum += a == null || b == null ? 12 : Math.min(20, Math.abs(a - b));
      n++;
    }
    return { date, score: n ? round(clamp((sum / n) * 2.4, 0, 10), 1) : null };
  });
  const measured = series.filter((x): x is { date: string; score: number } => x.score != null);
  if (measured.length < 2) return null;
  const today = measured[measured.length - 1];
  const prev = measured[measured.length - 2];
  const byProject = new Map<string, Set<string>>();
  for (const r of rows) byProject.set(r.project_id, (byProject.get(r.project_id) ?? new Set()).add(r.keyword));
  const movers: PersonalScore["movers"] = [];
  for (const [key, m] of byKey) {
    const [projectId, , keyword] = key.split("|");
    if (!m.has(prev.date) || !m.has(today.date)) continue;
    const from = m.get(prev.date) ?? null;
    const to = m.get(today.date) ?? null;
    if (from === to) continue;
    movers.push({ keyword, domain: projects.find((p) => p.id === projectId)?.domain ?? "", from, to });
  }
  const size = (x: { from: number | null; to: number | null }) => (x.from == null || x.to == null ? 15 : Math.abs(x.from - x.to));
  const sources = new Set(rows.map((r) => r.source));
  const only = sources.size === 1 ? [...sources][0] : null;
  const source: DataSource = only === "search-console" ? "search-console" : only === "demo" ? "demo" : "dataforseo";
  return {
    basis: "rankings",
    source,
    keywords: new Set(rows.map((r) => `${r.project_id}|${r.keyword}`)).size,
    projects: projects.filter((p) => byProject.has(p.id)).map((p) => ({ id: p.id, name: p.name, domain: p.domain, keywords: byProject.get(p.id)!.size })),
    series: measured,
    today: today.score,
    change: round(today.score - prev.score, 1),
    avg30: round(measured.reduce((s, x) => s + x.score, 0) / measured.length, 1),
    movers: movers.sort((a, b) => size(b) - size(a)).slice(0, 5),
  };
}

// ------------------------------------------------------------------------------------------ market

/** One stored daily snapshot: top-10 organic results and SERP feature types for a panel keyword. */
export type SerpSnapshot = { keyword: string; day: string; results: { url: string; domain: string; rank: number }[]; features: string[] };

const FEATURE_TYPES: Record<string, string> = {
  ai_overview: "ai_overview",
  featured_snippet: "featured_snippet",
  people_also_ask: "people_also_ask",
  local_pack: "local_pack",
  video: "video",
  shopping: "shopping",
  popular_products: "shopping",
  images: "image_pack",
  top_stories: "top_stories",
  knowledge_graph: "knowledge_panel",
  discussions_and_forums: "discussions",
  perspectives: "discussions",
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Map a DataForSEO serp/google/organic/live result to a snapshot (defensive: unknown fields are ignored). */
export function snapshotFromSerp(keyword: string, day: string, result: Record<string, unknown> | undefined): SerpSnapshot {
  const items = (Array.isArray(result?.items) ? result.items : []) as Record<string, unknown>[];
  const results: SerpSnapshot["results"] = [];
  const features = new Set<string>();
  for (const it of items) {
    const type = String(it?.type ?? "");
    if (type === "organic") {
      const url = typeof it.url === "string" ? it.url : "";
      const rank = Number(it.rank_group ?? results.length + 1);
      if (url && results.length < 10) results.push({ url: url.split("#")[0], domain: (typeof it.domain === "string" ? it.domain : hostOf(url)).replace(/^www\./, ""), rank });
    } else if (FEATURE_TYPES[type]) features.add(FEATURE_TYPES[type]);
  }
  const extra = Array.isArray(result?.item_types) ? (result.item_types as unknown[]) : [];
  for (const t of extra) if (typeof t === "string" && FEATURE_TYPES[t]) features.add(FEATURE_TYPES[t]);
  return { keyword, day, results, features: [...features].sort() };
}

/**
 * Change between two top-10 snapshots of one keyword, 0–10: mean absolute rank change over the union of
 * URLs (a URL that entered or left the top 10 counts as moving to/from position 11), ×2.
 */
export function serpChange(prev: SerpSnapshot, cur: SerpSnapshot) {
  const a = new Map(prev.results.map((r) => [r.url, r.rank]));
  const b = new Map(cur.results.map((r) => [r.url, r.rank]));
  const urls = new Set([...a.keys(), ...b.keys()]);
  if (!urls.size) return null;
  let sum = 0;
  for (const u of urls) sum += Math.abs((a.get(u) ?? 11) - (b.get(u) ?? 11));
  return round(clamp((sum / urls.size) * 2, 0, 10), 1);
}

export type MarketDay = { date: string; score: number; keywords: number };

/** Daily market volatility from snapshots: mean serpChange over keywords present on both consecutive days. */
export function marketSeries(snaps: SerpSnapshot[]): MarketDay[] {
  const byDay = new Map<string, Map<string, SerpSnapshot>>();
  for (const s of snaps) (byDay.get(s.day) ?? byDay.set(s.day, new Map()).get(s.day)!).set(s.keyword, s);
  const days = [...byDay.keys()].sort();
  const out: MarketDay[] = [];
  for (let i = 1; i < days.length; i++) {
    const prev = byDay.get(days[i - 1])!;
    const cur = byDay.get(days[i])!;
    const scores: number[] = [];
    for (const [k, s] of cur) {
      const p = prev.get(k);
      if (!p || !p.results.length || !s.results.length) continue;
      const c = serpChange(p, s);
      if (c != null) scores.push(c);
    }
    if (scores.length) out.push({ date: days[i], score: round(scores.reduce((x, y) => x + y, 0) / scores.length, 1), keywords: scores.length });
  }
  return out;
}

/** Share (%) of panel SERPs showing each feature, per day. */
export function featureShares(snaps: SerpSnapshot[]) {
  const byDay = new Map<string, SerpSnapshot[]>();
  for (const s of snaps) (byDay.get(s.day) ?? byDay.set(s.day, []).get(s.day)!).push(s);
  const features = [...new Set(snaps.flatMap((s) => s.features))].sort();
  const rows = [...byDay.entries()]
    .sort((x, y) => x[0].localeCompare(y[0]))
    .map(([date, list]) => {
      const row: Record<string, string | number> = { date };
      for (const f of features) row[f] = round((list.filter((s) => s.features.includes(f)).length / list.length) * 100, 1);
      return row;
    });
  return { features, rows };
}

/** Approximate CTR by organic position, used to weigh domain visibility in the panel. */
const CTR = [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];

/** Domains whose share of panel visibility changed most between two days (percentage points). */
export function domainMovers(prev: SerpSnapshot[], cur: SerpSnapshot[], limit = 6) {
  const share = (list: SerpSnapshot[]) => {
    const m = new Map<string, number>();
    let total = 0;
    for (const s of list)
      for (const r of s.results) {
        const w = CTR[r.rank - 1] ?? 0;
        m.set(r.domain, (m.get(r.domain) ?? 0) + w);
        total += w;
      }
    return new Map([...m].map(([d, v]) => [d, total ? (v / total) * 100 : 0]));
  };
  const keys = new Set(cur.map((s) => s.keyword).filter((k) => prev.some((p) => p.keyword === k)));
  const a = share(prev.filter((s) => keys.has(s.keyword)));
  const b = share(cur.filter((s) => keys.has(s.keyword)));
  const rows = [...new Set([...a.keys(), ...b.keys()])].map((domain) => ({ domain, visibility: round(b.get(domain) ?? 0, 2), change: round((b.get(domain) ?? 0) - (a.get(domain) ?? 0), 2) }));
  return {
    winners: rows.filter((r) => r.change > 0).sort((x, y) => y.change - x.change).slice(0, limit),
    losers: rows.filter((r) => r.change < 0).sort((x, y) => x.change - y.change).slice(0, limit),
  };
}
