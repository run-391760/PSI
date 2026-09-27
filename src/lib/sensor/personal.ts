import { query } from "@/lib/db";
import { demoAllowed } from "@/lib/data-mode";
import { listProjects } from "@/lib/projects";
import { clamp, hash, positionOn, round } from "@/lib/seo/engine";
import { lastDays } from "./days";
import { personalFromRows, type PersonalScore, type RankRow } from "./volatility";

/**
 * "Personal score": volatility of the user's own tracked keywords (Position Tracking), on the same
 * 0–10 scale as the SERP Sensor. Preferred basis: Position Tracking's stored daily rankings
 * (pt_rankings) from any real source; rows with source "demo" are ignored unless DEMO_DATA=true.
 * The demo-engine fallback (tracked keywords with positionOn() positions) runs only when DEMO_DATA=true.
 */

const state = globalThis as unknown as { synapsePersonal?: Map<string, PersonalScore | null> };

export type { PersonalScore };

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

/** Personal score from Position Tracking's stored daily rankings (pt_rankings); demo rows only when DEMO_DATA=true. */
async function fromRankings(ownerId: string, projects: Awaited<ReturnType<typeof listProjects>>, days: number): Promise<PersonalScore | null> {
  const dates = lastDays(days + 1);
  let rows: RankRow[] = [];
  try {
    const [reg] = await query<{ ok: boolean }>("SELECT to_regclass('pt_rankings') IS NOT NULL AND to_regclass('pt_keywords') IS NOT NULL AS ok");
    if (!reg?.ok) return null;
    rows = await query<RankRow>(
      `SELECT r.project_id, k.keyword, r.device, r.day, r.positions->>p.domain AS pos, r.source
         FROM pt_rankings r JOIN projects p ON p.id=r.project_id JOIN pt_keywords k ON k.id=r.keyword_id
        WHERE p.owner_id=$1 AND r.day >= $2 AND ($3::boolean OR r.source <> 'demo') ORDER BY r.day LIMIT 60000`,
      [ownerId, dates[0], demoAllowed()],
    );
  } catch {
    return null;
  }
  return personalFromRows(rows, dates, projects);
}

export async function personalVolatility(ownerId: string, days = 30): Promise<PersonalScore | null> {
  const projects = await listProjects(ownerId);
  if (!projects.length) return null;
  const stored = await fromRankings(ownerId, projects, days);
  if (stored || !demoAllowed()) return stored;
  // DEMO_DATA=true only: tracked keywords with demo-engine positions.
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
