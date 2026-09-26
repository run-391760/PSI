"use server";

import { revalidatePath } from "next/cache";
import { rateLimit, requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { cancelJob, enqueue, getJob, latestJob, setSchedule } from "@/lib/jobs/queue";
import { getProject, updateProjectSettings } from "@/lib/projects";
import { CRAWL_KIND, CWV_KIND, parseConfig, type ConfigInput } from "@/lib/site-audit/config";
import { getCrawl } from "@/lib/site-audit/data";
import type { AuditConfig } from "@/lib/site-audit/types";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AppError) return { ok: false, error: e.message };
  if (e && typeof e === "object" && "issues" in e) return { ok: false, error: (e as { issues: { message: string }[] }).issues[0]?.message ?? "Invalid settings." };
  console.error(e);
  return { ok: false, error: "Something went wrong. Please try again." };
}

async function applySchedule(projectId: string, cfg: AuditConfig) {
  if (cfg.schedule === "off") await setSchedule(projectId, CRAWL_KIND, { cadence: "weekly", enabled: false, payload: {} });
  else await setSchedule(projectId, CRAWL_KIND, { cadence: cfg.schedule, enabled: true, payload: {} });
}

/** Save Site Audit settings (and the re-crawl schedule) for a project. */
export async function saveAuditSettings(projectId: string, input: ConfigInput): Promise<Result<{ config: AuditConfig }>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    const cfg = parseConfig(project, input);
    await updateProjectSettings(user.id, project.id, { siteAudit: cfg });
    await applySchedule(project.id, cfg);
    revalidatePath("/site-audit");
    return { ok: true, data: { config: cfg } };
  } catch (e) {
    return fail(e);
  }
}

/** Start a crawl now (optionally saving new settings first). Returns the running job if one exists. */
export async function startAudit(projectId: string, input?: ConfigInput): Promise<Result<{ jobId: string }>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    if (input) {
      const cfg = parseConfig(project, input);
      await updateProjectSettings(user.id, project.id, { siteAudit: cfg });
      await applySchedule(project.id, cfg);
    }
    const active = await latestJob(project.id, CRAWL_KIND);
    if (active && (active.status === "queued" || active.status === "running")) return { ok: true, data: { jobId: active.id } };
    await rateLimit(`site-audit:start:${user.id}`, 30, 3600);
    const job = await enqueue({ kind: CRAWL_KIND, ownerId: user.id, projectId: project.id, payload: { manual: true }, dedupeKey: `site-audit:${project.id}:${Date.now()}` });
    revalidatePath("/site-audit");
    return { ok: true, data: { jobId: job.id } };
  } catch (e) {
    return fail(e);
  }
}

/** Stop a running crawl. Pages crawled so far are analyzed and kept as a partial ("stopped") crawl. */
export async function stopAudit(projectId: string, jobId: string): Promise<Result<null>> {
  try {
    const user = await requireUser();
    await getProject(user.id, projectId);
    const job = await getJob(user.id, jobId);
    if (job.project_id !== projectId) throw new AppError("Job not found.", 404);
    await cancelJob(user.id, jobId);
    revalidatePath("/site-audit");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

/** Re-run PageSpeed Insights for a finished crawl. */
export async function remeasureCwv(projectId: string, crawlId: string): Promise<Result<{ jobId: string }>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    const crawl = await getCrawl(project.id, crawlId);
    if (!crawl || crawl.details_pruned) throw new AppError("Crawl not found.", 404);
    await rateLimit(`site-audit:cwv:${user.id}`, 20, 3600);
    const job = await enqueue({ kind: CWV_KIND, ownerId: user.id, projectId: project.id, payload: { crawlId }, dedupeKey: `site-audit-cwv:${crawlId}:${Math.floor(Date.now() / 60000)}` });
    revalidatePath("/site-audit");
    return { ok: true, data: { jobId: job.id } };
  } catch (e) {
    return fail(e);
  }
}
