import { query } from "@/lib/db";
import { listProjects } from "@/lib/projects";
import { clamp, hash, positionOn, round } from "@/lib/seo/engine";
import { lastDays } from "./engine";

/**
 * "Personal score": volatility of the user's own tracked keywords (Position Tracking), on the same
 * 0–10 scale as the SERP Sensor. Preferred basis: Position Tracking's stored daily rankings
 * (pt_rankings). Fallback when no rankings are stored yet: the tracked keywords (discovered by
 * columns) with daily positions from the demo engine's positionOn(), which Position Tracking also
 * uses in demo mode.
 */

const state = globalThis as unknown as { synapsePersonal?: Map<string, PersonalScore | null> };

export type PersonalScore = {
  /** Where positions came from: Position Tracking's stored daily rankings, or the demo engine. */
  basis: "rankings" | "engine";
  source: "demo" | "dataforseo";
  keywords: number;
  projects: { id: string; name: string; domain: string; keywords: number }[];
  series: { date: string; score: number }[];
  today: number;
  change: number;
  avg30: number;
  movers: { keyword: string; domain: string; from: number | null; to: number | null }[];
};

async function trackedKeywordTable() {
  const rows = await query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name LIKE 'pt\\_%' AND column_name IN ('project_id','keyword')
      GROUP BY table_name HAVING count(DISTINCT column_name) = 2
      ORDER BY (table_name LIKE '%keyword%') DESC, table_name LIMIT 1`,
  );
  const name = rows[0]?.table_name;
  return name && /^[a-z_][a-z0-9_]*$/.test(name) ? name : null;
}

type RankRow = { project_id: string; keyword: string; device: string; day: string; pos: string | null; source: string };

/** Personal score from Position Tracking's stored daily rankings (pt_rankings), when present. */
async function fromRankings(ownerId: string, projects: Awaited<ReturnType<typeof listProjects>>, days: number): Promise<PersonalScore | null> {
  const dates = lastDays(days + 1);
  let rows: RankRow[] = [];
  try {
    const [reg] = await query<{ ok: boolean }>("SELECT to_regclass('pt_rankings') IS NOT NULL AND to_regclass('pt_keywords') IS NOT NULL AS ok");
    if (!reg?.ok) return null;
    rows = await query<RankRow>(
      `SELECT r.project_id, k.keyword, r.device, r.day, r.positions->>p.domain AS pos, r.source
         FROM pt_rankings r JOIN projects p ON p.id=r.project_id JOIN pt_keywords k ON k.id=r.keyword_id
        WHERE p.owner_id=$1 AND r.day >= $2 ORDER BY r.day LIMIT 60000`,
      [ownerId, dates[0]],
    );
  } catch {
    return null;
  }
  if (!rows.length) return null;
  const series_: Map<string, Map<string, number | null>> = new Map();
  for (const r of rows) {
    const key = `${r.project_id}|${r.device}|${r.keyword}`;
    const m = series_.get(key) ?? new Map<string, number | null>();
    const n = r.pos == null || r.pos === "" ? null : Number(r.pos);
    m.set(r.day, Number.isFinite(n as number) ? (n as number) : null);
    series_.set(key, m);
  }
  const series = dates.slice(1).map((date, i) => {
    let sum = 0;
    let n = 0;
    for (const m of series_.values()) {
      if (!m.has(date) || !m.has(dates[i])) continue;
      const a = m.get(dates[i]) ?? null;
      const b = m.get(date) ?? null;
      if (a == null && b == null) continue;
      sum += a == null || b == null ? 12 : Math.min(20, Math.abs(a - b));
      n++;
    }
    return { date, score: n ? round(clamp((sum / n) * 2.4, 0, 10), 1) : (null as unknown as number) };
  });
  const measured = series.filter((x) => x.score != null);
  if (measured.length < 2) return null;
  const today = measured[measured.length - 1];
  const prev = measured[measured.length - 2];
  const byProject = new Map<string, Set<string>>();
  for (const r of rows) byProject.set(r.project_id, (byProject.get(r.project_id) ?? new Set()).add(r.keyword));
  const lastDay = today.date;
  const prevDay = prev.date;
  const movers: PersonalScore["movers"] = [];
  for (const [key, m] of series_) {
    const [projectId, , keyword] = key.split("|");
    const from = m.get(prevDay) ?? null;
    const to = m.get(lastDay) ?? null;
    if (!m.has(prevDay) || !m.has(lastDay) || from === to) continue;
    movers.push({ keyword, domain: projects.find((p) => p.id === projectId)?.domain ?? "", from, to });
  }
  const size = (x: { from: number | null; to: number | null }) => (x.from == null || x.to == null ? 15 : Math.abs(x.from - x.to));
  return {
    basis: "rankings",
    source: rows.every((r) => r.source === "demo") ? "demo" : "dataforseo",
    keywords: new Set(rows.map((r) => `${r.project_id}|${r.keyword}`)).size,
    projects: projects.filter((p) => byProject.has(p.id)).map((p) => ({ id: p.id, name: p.name, domain: p.domain, keywords: byProject.get(p.id)!.size })),
    series: measured,
    today: today.score,
    change: round(today.score - prev.score, 1),
    avg30: round(measured.reduce((s, x) => s + x.score, 0) / measured.length, 1),
    movers: movers.sort((a, b) => size(b) - size(a)).slice(0, 5),
  };
}

export async function personalVolatility(ownerId: string, days = 30): Promise<PersonalScore | null> {
  const projects = await listProjects(ownerId);
  if (!projects.length) return null;
  const stored = await fromRankings(ownerId, projects, days);
  if (stored) return stored;
  let table: string | null = null;
  try {
    table = await trackedKeywordTable();
  } catch {
    return null;
  }
  if (!table) return null;
  let rows: { project_id: string; keyword: string }[] = [];
  try {
    rows = await query<{ project_id: string; keyword: string }>(`SELECT DISTINCT project_id, keyword FROM ${table} WHERE project_id = ANY($1::text[]) LIMIT 3000`, [projects.map((p) => p.id)]);
  } catch {
    return null;
  }
  rows = rows.filter((r) => typeof r.keyword === "string" && r.keyword.trim());
  if (!rows.length) return null;

  // Cap the work: up to 40 keywords per project, 80 overall (deterministic pick).
  const byProject = new Map<string, string[]>();
  for (const r of rows) byProject.set(r.project_id, [...(byProject.get(r.project_id) ?? []), r.keyword]);
  const picked: { project: (typeof projects)[number]; keyword: string }[] = [];
  for (const p of projects) {
    const kws = (byProject.get(p.id) ?? []).sort((a, b) => hash(a) - hash(b)).slice(0, 40);
    for (const k of kws) if (picked.length < 80) picked.push({ project: p, keyword: k });
  }
  const dates = lastDays(days + 1);
  const cacheKey = `${ownerId}:${dates[dates.length - 1]}:${hash(picked.map((p) => `${p.project.id}|${p.project.country}|${p.project.device}|${p.keyword}`).join(","))}`;
  state.synapsePersonal ??= new Map();
  if (state.synapsePersonal.has(cacheKey)) return state.synapsePersonal.get(cacheKey)!;

  const positions = picked.map(({ project, keyword }) => dates.map((d) => positionOn(project.domain, keyword, project.country, project.device, d)));
  const series = dates.slice(1).map((date, i) => {
    let sum = 0;
    let n = 0;
    for (const p of positions) {
      const a = p[i];
      const b = p[i + 1];
      if (a == null && b == null) continue;
      sum += a == null || b == null ? 12 : Math.min(20, Math.abs(a - b));
      n++;
    }
    return { date, score: round(clamp(n ? (sum / n) * 2.4 : 0, 0, 10), 1) };
  });
  const last = positions.map((p, i) => ({ keyword: picked[i].keyword, domain: picked[i].project.domain, from: p[p.length - 2], to: p[p.length - 1] }));
  const moveSize = (m: { from: number | null; to: number | null }) => (m.from == null || m.to == null ? (m.from == null && m.to == null ? 0 : 15) : Math.abs(m.from - m.to));
  const today = series[series.length - 1];
  const result: PersonalScore = {
    basis: "engine",
    source: "demo",
    keywords: picked.length,
    projects: projects.filter((p) => byProject.has(p.id)).map((p) => ({ id: p.id, name: p.name, domain: p.domain, keywords: byProject.get(p.id)!.length })),
    series,
    today: today.score,
    change: round(today.score - series[series.length - 2].score, 1),
    avg30: round(series.reduce((s, x) => s + x.score, 0) / series.length, 1),
    movers: last.filter((m) => moveSize(m) > 0).sort((a, b) => moveSize(b) - moveSize(a)).slice(0, 5),
  };
  if (state.synapsePersonal.size > 200) state.synapsePersonal.clear();
  state.synapsePersonal.set(cacheKey, result);
  return result;
}
