import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import type { LogSummary } from "./parser";

export type AnalysisRow = { id: string; name: string; origin: "upload" | "sample"; size_bytes: string; total_lines: number; parsed_lines: number; bot_hits: number; date_from: string | null; date_to: string | null; created_at: string };
export type Analysis = AnalysisRow & { summary: LogSummary };

const MAX_ANALYSES = 50;

export async function saveAnalysis(ownerId: string, input: { name: string; origin: "upload" | "sample"; sizeBytes: number; summary: LogSummary }) {
  const [{ count }] = await query<{ count: number }>("SELECT count(*)::int AS count FROM content_log_analyses WHERE owner_id=$1", [ownerId]);
  if (count >= MAX_ANALYSES) throw new AppError(`You can keep up to ${MAX_ANALYSES} log analyses. Delete older ones first.`);
  const id = randomUUID();
  const s = input.summary;
  await query(
    `INSERT INTO content_log_analyses(id,owner_id,name,origin,size_bytes,total_lines,parsed_lines,bot_hits,date_from,date_to,summary)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [id, ownerId, input.name.slice(0, 200), input.origin, input.sizeBytes, s.totals.lines, s.totals.parsed, s.totals.botHits, s.period.from, s.period.to, JSON.stringify(s)],
  );
  return id;
}
const iso = (d: unknown) => new Date(d as string).toISOString();
export async function listAnalyses(ownerId: string) {
  const rows = await query<AnalysisRow>(
    "SELECT id,name,origin,size_bytes,total_lines,parsed_lines,bot_hits,date_from,date_to,created_at FROM content_log_analyses WHERE owner_id=$1 ORDER BY created_at DESC",
    [ownerId],
  );
  return rows.map((r) => ({ ...r, size_bytes: String(r.size_bytes), created_at: iso(r.created_at) }));
}
export async function findAnalysis(ownerId: string, id: string) {
  const [row] = await query<Analysis>("SELECT * FROM content_log_analyses WHERE id=$1 AND owner_id=$2", [id, ownerId]);
  return row ? { ...row, size_bytes: String(row.size_bytes), created_at: iso(row.created_at) } : null;
}
export async function deleteAnalyses(ownerId: string, ids: string[]) {
  await query("DELETE FROM content_log_analyses WHERE owner_id=$1 AND id = ANY($2::text[])", [ownerId, ids]);
}
export async function renameAnalysis(ownerId: string, id: string, name: string) {
  const rows = await query("UPDATE content_log_analyses SET name=$3 WHERE id=$1 AND owner_id=$2 RETURNING id", [id, ownerId, name.slice(0, 200)]);
  if (!rows.length) throw new AppError("Analysis not found.", 404);
}
