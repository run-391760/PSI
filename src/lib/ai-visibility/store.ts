import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import type { LiveResult, PromptRow, ReadinessResult } from "./meta";

export async function listPrompts(projectId: string): Promise<PromptRow[]> {
  const rows = await query<{ id: string; prompt: string; source: "suggested" | "custom"; created_at: Date | string }>("SELECT id,prompt,source,created_at FROM ai_prompts WHERE project_id=$1 ORDER BY created_at, prompt", [projectId]);
  return rows.map((r) => ({ id: r.id, prompt: r.prompt, source: r.source, createdAt: new Date(r.created_at).toISOString() }));
}

export function cleanPrompt(p: string) {
  return p.normalize("NFKC").replace(/\s+/g, " ").trim().replace(/[?.!]+$/, "").toLowerCase();
}

export async function addPrompts(projectId: string, prompts: string[], source: "suggested" | "custom") {
  const clean = [...new Set(prompts.map(cleanPrompt).filter(Boolean))];
  if (clean.some((p) => p.length < 3 || p.length > 200)) throw new AppError("Prompts must be 3–200 characters.");
  const [{ n }] = await query<{ n: number }>("SELECT count(*)::int AS n FROM ai_prompts WHERE project_id=$1", [projectId]);
  if (n + clean.length > 50) throw new AppError(`You can track up to 50 prompts per project (${n} tracked).`);
  let added = 0;
  for (const p of clean) {
    const res = await query("INSERT INTO ai_prompts(id,project_id,prompt,source) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,prompt) DO NOTHING RETURNING id", [randomUUID(), projectId, p, source]);
    added += res.length;
  }
  return added;
}

export async function removePrompts(projectId: string, ids: string[]) {
  await query("DELETE FROM ai_prompts WHERE project_id=$1 AND id = ANY($2::text[])", [projectId, ids]);
}

export async function liveResults(projectId: string, limit = 300): Promise<LiveResult[]> {
  const rows = await query<{
    id: string;
    prompt: string;
    engine: string;
    model: string;
    created_at: Date | string;
    mentioned: boolean;
    cited: boolean;
    position: number | null;
    cited_urls: string[];
    competitors: string[];
    sources: string[];
    sentiment: LiveResult["sentiment"];
    answer: string;
    error: string | null;
  }>("SELECT * FROM ai_live_results WHERE project_id=$1 ORDER BY created_at DESC LIMIT $2", [projectId, limit]);
  return rows.map((r) => ({
    id: r.id,
    prompt: r.prompt,
    engine: r.engine,
    model: r.model,
    createdAt: new Date(r.created_at).toISOString(),
    mentioned: r.mentioned,
    cited: r.cited,
    position: r.position,
    citedUrls: r.cited_urls,
    competitors: r.competitors,
    sources: r.sources,
    sentiment: r.sentiment,
    answer: r.answer,
    error: r.error,
  }));
}

export async function saveLiveResult(projectId: string, jobId: string, r: Omit<LiveResult, "id" | "createdAt"> & { promptId: string | null }) {
  await query(
    `INSERT INTO ai_live_results(id,project_id,prompt_id,prompt,engine,model,job_id,mentioned,cited,position,cited_urls,competitors,sources,sentiment,answer,error)
     VALUES($1,$2,$3,$4,$16,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15)`,
    [randomUUID(), projectId, r.promptId, r.prompt, r.model, jobId, r.mentioned, r.cited, r.position, JSON.stringify(r.citedUrls), JSON.stringify(r.competitors), JSON.stringify(r.sources), r.sentiment, r.answer.slice(0, 8000), r.error, r.engine],
  );
}

export async function getReadiness(projectId: string) {
  const [row] = await query<{ result: ReadinessResult; checked_at: Date | string }>("SELECT result, checked_at FROM ai_readiness WHERE project_id=$1", [projectId]);
  return row ? { result: row.result, checkedAt: new Date(row.checked_at).toISOString() } : null;
}
export async function saveReadiness(projectId: string, result: ReadinessResult) {
  await query("INSERT INTO ai_readiness(project_id,result,checked_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(project_id) DO UPDATE SET result=excluded.result, checked_at=now()", [projectId, JSON.stringify(result)]);
}
