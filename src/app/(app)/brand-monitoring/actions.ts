"use server";

import { requireUser } from "@/lib/auth";
import { demoAllowed } from "@/lib/data-mode";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { enqueue, setSchedule } from "@/lib/jobs/queue";
import { getProject, updateProject } from "@/lib/projects";
import { getBrandSettings, saveBrandSettings, setMentionStatus, setMentionTags, type MentionStatus } from "@/lib/monitoring/brand";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";

function cleanTerms(list: string[], label: string, min: number) {
  const terms = [...new Set(list.map((t) => t.trim().replace(/\s+/g, " ")).filter(Boolean))];
  if (terms.length < min) throw new AppError(`Add at least ${min} ${label}.`);
  if (terms.length > 5) throw new AppError(`Use at most 5 ${label}.`);
  if (terms.some((t) => t.length < 2 || t.length > 60)) throw new AppError(`Each of the ${label} must be 2–60 characters.`);
  if (terms.some((t) => /["<>]/.test(t))) throw new AppError(`Remove quotes and angle brackets from the ${label}.`);
  return terms;
}

async function startRun(ownerId: string, projectId: string) {
  const [running] = await query<{ id: string }>("SELECT id FROM jobs WHERE project_id=$1 AND kind='monitoring.brand' AND status IN ('queued','running') LIMIT 1", [projectId]);
  if (running) return running.id;
  const job = await enqueue({ kind: "monitoring.brand", ownerId, projectId, payload: { manual: true } });
  return job.id;
}

export async function saveBrandSettingsAction(projectId: string, input: { terms: string[]; competitorTerms: string[]; demoSocial: boolean; daily: boolean }): Promise<ActionResult<{ jobId: string }>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    const terms = cleanTerms(input.terms, "brand terms", 1);
    const competitorTerms = cleanTerms(input.competitorTerms, "competitor names", 0);
    if (JSON.stringify(terms) !== JSON.stringify(project.brand_terms)) await updateProject(user.id, project.id, { brand_terms: terms });
    await saveBrandSettings(project.id, { competitorTerms, demoSocial: !!input.demoSocial && demoAllowed() });
    await setSchedule(project.id, "monitoring.brand", { cadence: "daily", enabled: !!input.daily });
    const jobId = await startRun(user.id, project.id);
    return { ok: true, data: { jobId } };
  } catch (e) {
    return actionError(e);
  }
}

export async function fetchMentionsAction(projectId: string): Promise<ActionResult<{ jobId: string }>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    if (!(await getBrandSettings(project.id))) throw new AppError("Set up brand monitoring first.");
    return { ok: true, data: { jobId: await startRun(user.id, project.id) } };
  } catch (e) {
    return actionError(e);
  }
}

export async function setMentionStatusAction(projectId: string, ids: string[], status: MentionStatus): Promise<ActionResult<{ updated: number }>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    if (!["new", "reviewed", "archived"].includes(status)) throw new AppError("Invalid status.");
    if (!Array.isArray(ids) || ids.length > 2000) throw new AppError("Select up to 2,000 mentions.");
    return { ok: true, data: { updated: await setMentionStatus(project.id, ids.map(String), status) } };
  } catch (e) {
    return actionError(e);
  }
}

export async function setMentionTagsAction(projectId: string, id: string, tags: string[]): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
    if (clean.length > 8 || clean.some((t) => t.length > 32)) throw new AppError("Use up to 8 tags of at most 32 characters.");
    await setMentionTags(project.id, id, clean);
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
