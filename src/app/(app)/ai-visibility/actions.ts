"use server";

import { rateLimit, requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { enqueue } from "@/lib/jobs/queue";
import { getProject } from "@/lib/projects";
import { enabledLiveEngines } from "@/lib/providers/ai-engines";
import { loadAiContext, saveAiCompetitorNames } from "@/lib/ai-visibility/context";
import { suggestPrompts } from "@/lib/ai-visibility/engine";
import { checkReadiness } from "@/lib/ai-visibility/readiness";
import { addPrompts, listPrompts, removePrompts, saveReadiness } from "@/lib/ai-visibility/store";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";

export async function addPromptsAction(projectId: string, prompts: string[], source: "suggested" | "custom" = "custom"): Promise<ActionResult<{ added: number }>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    if (!Array.isArray(prompts) || !prompts.length) throw new AppError("Enter at least one prompt.");
    const added = await addPrompts(project.id, prompts.map(String), source === "suggested" ? "suggested" : "custom");
    if (!added) throw new AppError("Those prompts are already tracked.");
    return { ok: true, data: { added } };
  } catch (e) {
    return actionError(e);
  }
}

export async function suggestPromptsAction(projectId: string): Promise<ActionResult<{ added: number }>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    const existing = new Set((await listPrompts(project.id)).map((p) => p.prompt));
    const ctx = await loadAiContext(project);
    const fresh = suggestPrompts(ctx, project).filter((p) => !existing.has(p));
    if (!fresh.length) throw new AppError("All suggested prompts are already tracked.");
    return { ok: true, data: { added: await addPrompts(project.id, fresh, "suggested") } };
  } catch (e) {
    return actionError(e);
  }
}

export async function removePromptsAction(projectId: string, ids: string[]): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    await removePrompts(project.id, ids.map(String));
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function saveCompetitorNamesAction(projectId: string, names: string[]): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    const clean = [...new Set(names.map((n) => n.trim().replace(/\s+/g, " ")).filter(Boolean))];
    if (clean.length > 5) throw new AppError("Track at most 5 competitor names.");
    if (clean.some((n) => n.length < 2 || n.length > 60)) throw new AppError("Competitor names must be 2–60 characters.");
    await saveAiCompetitorNames(project.id, clean);
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function runReadinessAction(projectId: string): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    await rateLimit(`ai-readiness:${user.id}`, 10, 60);
    await saveReadiness(project.id, await checkReadiness(project.domain));
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function runLiveCheckAction(projectId: string, engines?: string[]): Promise<ActionResult<{ jobId: string }>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    const available = enabledLiveEngines().map((e) => e.id as string);
    const chosen = engines?.length ? engines.filter((e) => available.includes(e)) : available;
    if (!available.length) throw new AppError("Connect at least one AI engine: set OPENAI_API_KEY, GEMINI_API_KEY, PERPLEXITY_API_KEY, ANTHROPIC_API_KEY or DataForSEO credentials on the server.");
    if (!chosen.length) throw new AppError("None of the selected engines is connected.");
    if (!(await listPrompts(project.id)).length) throw new AppError("Add prompts to track first.");
    const [running] = await query<{ id: string }>("SELECT id FROM jobs WHERE project_id=$1 AND kind='ai-visibility.run' AND status IN ('queued','running') LIMIT 1", [project.id]);
    if (running) return { ok: true, data: { jobId: running.id } };
    const job = await enqueue({ kind: "ai-visibility.run", ownerId: user.id, projectId: project.id, payload: { engines: chosen } });
    return { ok: true, data: { jobId: job.id } };
  } catch (e) {
    return actionError(e);
  }
}
