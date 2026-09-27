"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getProjectGoogle } from "@/lib/google/data";
import { googleConfigured } from "@/lib/google/oauth";
import { gscPairs } from "@/lib/content/real";
import { fail, type ActionResult } from "@/lib/content/action";
import { addTargets, liveSuggestions, removeTargets, setIdeaDone, startRun, type Suggestion } from "@/lib/content/onpage";
import { getProject } from "@/lib/projects";
import { setSchedule } from "@/lib/jobs/queue";

const pairsSchema = z
  .array(z.object({ url: z.string().max(2000), keyword: z.string().max(200), origin: z.enum(["manual", "csv", "gsc", "live"]).optional() }))
  .min(1, "Add at least one page.")
  .max(200, "Add at most 200 rows at a time.");

export async function addTargetsAction(projectId: string, pairs: { url: string; keyword: string; origin?: "manual" | "csv" | "gsc" | "live" }[]): Promise<ActionResult<{ added: number; skipped: { input: string; reason: string }[] }>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    const res = await addTargets(project, pairsSchema.parse(pairs));
    revalidatePath("/on-page-checker");
    return { ok: true, data: res };
  } catch (e) {
    return fail(e);
  }
}

export async function removeTargetsAction(projectId: string, ids: string[]): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    await getProject(user.id, projectId);
    await removeTargets(projectId, z.array(z.string().max(64)).max(500).parse(ids));
    revalidatePath("/on-page-checker");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function discoverLiveAction(projectId: string): Promise<ActionResult<{ fetchedUrl: string; suggestions: Suggestion[] }>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    const link = googleConfigured() ? await getProjectGoogle(project.id) : null;
    const pairs = link?.gscSite ? await gscPairs(user.id, link.gscSite, 500).then((r) => r.data).catch(() => []) : [];
    return { ok: true, data: await liveSuggestions(project.domain, pairs) };
  } catch (e) {
    return fail(e);
  }
}

export async function startRunAction(projectId: string): Promise<ActionResult<{ jobId: string }>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    const job = await startRun(user.id, project);
    revalidatePath("/on-page-checker");
    return { ok: true, data: { jobId: job.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function toggleIdeaAction(projectId: string, targetId: string, ideaId: string, done: boolean): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    await getProject(user.id, projectId);
    await setIdeaDone(projectId, z.string().max(64).parse(targetId), z.string().max(80).parse(ideaId), done);
    revalidatePath("/on-page-checker");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function setWeeklyAction(projectId: string, enabled: boolean): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    await getProject(user.id, projectId);
    await setSchedule(projectId, "content.onpage", { cadence: "weekly", enabled, payload: {} });
    revalidatePath("/on-page-checker");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}
