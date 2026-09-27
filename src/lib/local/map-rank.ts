import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { demoAllowed } from "@/lib/data-mode";
import { liveEnabled } from "@/lib/providers/source";
import { enqueue } from "@/lib/jobs/queue";
import { clamp, round, unit } from "@/lib/seo/engine";
import type { Project } from "@/lib/projects";
import { localCompetitors, type LocalBusiness } from "./competitors";
import { offsetKm, type GeoPoint } from "./geo";
import type { BusinessProfile } from "./profile-schema";

/**
 * Map Rank Tracker: local-pack rankings on a geo-grid around the business. Real scans (source
 * "dataforseo") query Google Maps results at every grid point via DataForSEO. The deterministic
 * simulation (source "demo") runs only with DEMO_DATA=true and demo scans are hidden otherwise.
 */

export const GRID_SIZES = [3, 5, 7, 9] as const;
export type GridSize = (typeof GRID_SIZES)[number];
export const PACK_WEIGHTS = [0.5, 0.3, 0.2];

export type GridCell = { row: number; col: number; lat: number; lng: number; rank: number | null; pack: string[] };
export type ScanMetrics = {
  cells: number;
  found: number;
  top3: number;
  top10: number;
  avgRank: number | null;
  /** Average total rank position: 20+ counted as 21. */
  atrp: number;
  /** Share of local voice: your weighted share of local-pack visibility (0..100). */
  solv: number;
  top3Pct: number;
  foundPct: number;
  buckets: { top3: number; top4_10: number; top11_20: number; notFound: number };
};
export type CompetitorStat = { id: string; name: string; you: boolean; avgRank: number | null; top3: number; solv: number; rating: number | null; reviews: number | null };
/** A business competing in the local pack (demo: simulated; live: seen in Google Maps results). */
export type PackBusiness = { id: string; name: string; you?: boolean; rating: number | null; reviews: number | null };
export type KeywordResult = { keyword: string; cells: GridCell[]; metrics: ScanMetrics; competitors: CompetitorStat[] };

export type ScanRow = {
  id: string;
  project_id: string;
  keywords: string[];
  grid_size: GridSize;
  radius_km: number;
  center: GeoPoint;
  seq: number;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  source: "demo" | "dataforseo";
  job_id: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

// ---------------------------------------------------------------------------------------------- simulation

function relevance(b: LocalBusiness, keyword: string, domain: string) {
  return b.you ? 0.72 + 0.28 * unit(`relyou:${domain}:${keyword}`) : 0.55 + 0.45 * unit(`rel:${b.id}:${keyword}`);
}
/** Your prominence drifts a little from scan to scan (mostly upwards: you are working on it). */
function youStrength(b: LocalBusiness, keyword: string, domain: string, seq: number) {
  const trend = (unit(`trend:${domain}:${keyword}`) - 0.3) * 0.018;
  return clamp(b.strength + trend * (seq - 1), 0.1, 0.99);
}

export function cellOffsets(grid: number, radiusKm: number) {
  const step = grid > 1 ? (2 * radiusKm) / (grid - 1) : 0;
  const half = (grid - 1) / 2;
  const cells: { row: number; col: number; x: number; y: number }[] = [];
  for (let row = 0; row < grid; row++) for (let col = 0; col < grid; col++) cells.push({ row, col, x: (col - half) * step, y: (half - row) * step });
  return cells;
}

export function simulateRow(input: { domain: string; businesses: LocalBusiness[]; center: GeoPoint; keyword: string; grid: number; radiusKm: number; seq: number; row: number }) {
  const { domain, businesses, center, keyword, grid, radiusKm, seq, row } = input;
  return cellOffsets(grid, radiusKm)
    .filter((c) => c.row === row)
    .map((c) => {
      const scored = businesses.map((b) => {
        const strength = b.you ? youStrength(b, keyword, domain, seq) : b.strength;
        const dist = Math.hypot(c.x - b.dx, c.y - b.dy);
        const noise = (unit(`mapn:${domain}:${keyword}:${b.id}:${c.row},${c.col}:${seq}`) - 0.5) * 0.16;
        return { b, score: strength * relevance(b, keyword, domain) - 0.24 * dist ** 0.9 + noise };
      });
      scored.sort((a, b) => b.score - a.score);
      const idx = scored.findIndex((s) => s.b.you);
      const p = offsetKm(center, c.x, c.y);
      return { row: c.row, col: c.col, lat: p.lat, lng: p.lng, rank: idx + 1 <= 20 ? idx + 1 : null, pack: scored.slice(0, 3).map((s) => s.b.name), order: scored.map((s) => s.b.id) };
    });
}

export function summarize(cells: (GridCell & { order?: string[] })[], businesses: PackBusiness[]): { metrics: ScanMetrics; competitors: CompetitorStat[] } {
  const n = cells.length || 1;
  const ranks = cells.map((c) => c.rank);
  const found = ranks.filter((r): r is number => r != null);
  const buckets = { top3: 0, top4_10: 0, top11_20: 0, notFound: 0 };
  for (const r of ranks) {
    if (r == null) buckets.notFound++;
    else if (r <= 3) buckets.top3++;
    else if (r <= 10) buckets.top4_10++;
    else buckets.top11_20++;
  }
  const stats = new Map<string, { ranks: number[]; top3: number; solv: number }>();
  for (const c of cells) {
    const order = c.order ?? c.pack;
    order.forEach((id, i) => {
      const s = stats.get(id) ?? { ranks: [], top3: 0, solv: 0 };
      if (i < 20) s.ranks.push(i + 1);
      if (i < 3) {
        s.top3++;
        s.solv += PACK_WEIGHTS[i];
      }
      stats.set(id, s);
    });
  }
  const you = businesses.find((b) => b.you)!;
  const youSolv = cells.reduce((s, c) => s + (c.rank != null && c.rank <= 3 ? PACK_WEIGHTS[c.rank - 1] : 0), 0);
  const metrics: ScanMetrics = {
    cells: cells.length,
    found: found.length,
    top3: buckets.top3,
    top10: buckets.top3 + buckets.top4_10,
    avgRank: found.length ? round(found.reduce((s, r) => s + r, 0) / found.length, 1) : null,
    atrp: round(ranks.reduce<number>((s, r) => s + (r ?? 21), 0) / n, 1),
    solv: round((youSolv / n) * 100, 1),
    top3Pct: round((buckets.top3 / n) * 100, 1),
    foundPct: round((found.length / n) * 100, 1),
    buckets,
  };
  const competitors: CompetitorStat[] = businesses
    .map((b) => {
      const s = stats.get(b.id);
      const avg = s?.ranks.length ? round(s.ranks.reduce((a, x) => a + x, 0) / s.ranks.length, 1) : null;
      return { id: b.id, name: b.name, you: !!b.you, avgRank: b.you ? metrics.avgRank : avg, top3: b.you ? buckets.top3 : (s?.top3 ?? 0), solv: b.you ? metrics.solv : round(((s?.solv ?? 0) / n) * 100, 1), rating: b.rating, reviews: b.reviews };
    })
    .filter((c) => c.you || c.top3 > 0)
    .sort((a, b) => b.solv - a.solv)
    .slice(0, 12);
  if (!competitors.some((c) => c.id === you.id)) competitors.push({ id: you.id, name: you.name, you: true, avgRank: metrics.avgRank, top3: 0, solv: 0, rating: you.rating, reviews: you.reviews });
  return { metrics, competitors };
}

// ---------------------------------------------------------------------------------------------- storage

const toIso = (d: Date | string | null) => (d == null ? null : new Date(d).toISOString());

function mapScan(r: ScanRow & { created_at: Date | string; finished_at: Date | string | null }): ScanRow {
  return { ...r, radius_km: Number(r.radius_km), created_at: toIso(r.created_at)!, finished_at: toIso(r.finished_at) };
}

export async function listScans(projectId: string, limit = 30) {
  const rows = await query<ScanRow & { avg_rank: number | null; solv: number | null; top3_pct: number | null }>(
    `SELECT s.*, (SELECT avg((r.metrics->>'avgRank')::float) FROM local_scan_results r WHERE r.scan_id=s.id) AS avg_rank,
            (SELECT avg((r.metrics->>'solv')::float) FROM local_scan_results r WHERE r.scan_id=s.id) AS solv,
            (SELECT avg((r.metrics->>'top3Pct')::float) FROM local_scan_results r WHERE r.scan_id=s.id) AS top3_pct
     FROM local_scans s WHERE s.project_id=$1 AND ($3::boolean OR s.source <> 'demo') ORDER BY s.created_at DESC LIMIT $2`,
    [projectId, limit, demoAllowed()],
  );
  return rows.map((r) => ({ ...mapScan(r), avgRank: r.avg_rank == null ? null : round(Number(r.avg_rank), 1), solv: r.solv == null ? null : round(Number(r.solv), 1), top3Pct: r.top3_pct == null ? null : round(Number(r.top3_pct), 1) }));
}
export type ScanSummary = Awaited<ReturnType<typeof listScans>>[number];

export async function getScan(projectId: string, scanId: string) {
  const [row] = await query<ScanRow>("SELECT * FROM local_scans WHERE id=$1 AND project_id=$2", [scanId, projectId]);
  return row ? mapScan(row) : null;
}

export async function scanResults(scanId: string): Promise<KeywordResult[]> {
  const rows = await query<{ keyword: string; cells: GridCell[]; metrics: ScanMetrics; competitors: CompetitorStat[] }>("SELECT keyword,cells,metrics,competitors FROM local_scan_results WHERE scan_id=$1", [scanId]);
  return rows;
}

export async function createScan(input: { ownerId: string; project: Project; profile: BusinessProfile; center: GeoPoint; keywords: string[]; grid: GridSize; radiusKm: number }) {
  const keywords = [...new Set(input.keywords.map((k) => k.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean))];
  if (!keywords.length) throw new AppError("Add at least one keyword.");
  if (keywords.length > 5) throw new AppError("A scan can track up to 5 keywords.");
  if (keywords.some((k) => k.length > 80)) throw new AppError("Keywords can be at most 80 characters.");
  if (!GRID_SIZES.includes(input.grid)) throw new AppError("Choose a 3×3, 5×5, 7×7 or 9×9 grid.");
  if (!(input.radiusKm >= 0.5 && input.radiusKm <= 25)) throw new AppError("Radius must be between 0.5 and 25 km.");
  const source = liveEnabled() ? "dataforseo" : demoAllowed() ? "demo" : null;
  if (!source) throw new AppError("Map rank scans need DataForSEO (Google Maps results). Connect it in Settings → Integrations.", 503);
  const [running] = await query<{ id: string }>("SELECT id FROM local_scans WHERE project_id=$1 AND status IN ('queued','running') LIMIT 1", [input.project.id]);
  if (running) throw new AppError("A scan is already running for this project. Wait for it to finish.", 409);
  const [{ n }] = await query<{ n: number }>("SELECT count(*)::int AS n FROM local_scans WHERE project_id=$1", [input.project.id]);
  const id = randomUUID();
  await query(
    `INSERT INTO local_scans(id,project_id,keywords,grid_size,radius_km,center,seq,status,source) VALUES($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7,'queued',$8)`,
    [id, input.project.id, JSON.stringify(keywords), input.grid, input.radiusKm, JSON.stringify(input.center), n + 1, source],
  );
  const job = await enqueue({ kind: "local.map-scan", ownerId: input.ownerId, projectId: input.project.id, payload: { scanId: id } });
  await query("UPDATE local_scans SET job_id=$2 WHERE id=$1", [id, job.id]);
  return { id, jobId: job.id };
}

export async function deleteScan(projectId: string, scanId: string) {
  await query("DELETE FROM local_scans WHERE id=$1 AND project_id=$2 AND status NOT IN ('queued','running')", [scanId, projectId]);
}

export function suggestedKeywords(profile: BusinessProfile) {
  const cat = profile.primaryCategory.toLowerCase();
  const city = profile.city.split(",")[0].trim().toLowerCase();
  return [...new Set([`${cat} near me`, `best ${cat} in ${city}`, `${cat} ${city}`, ...profile.categories.slice(0, 2).map((c) => `${c.toLowerCase()} near me`), `top rated ${cat}`])].filter((k) => k.trim().length > 3);
}
