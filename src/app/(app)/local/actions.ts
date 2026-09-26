"use server";

import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { enqueue, getSchedule, setSchedule } from "@/lib/jobs/queue";
import { query } from "@/lib/db";
import { getProject } from "@/lib/projects";
import { buildListings, distributionTargets, listingRows } from "@/lib/local/listings";
import { createScan, deleteScan, GRID_SIZES, type GridSize } from "@/lib/local/map-rank";
import { businessLocation, getProfile, saveProfile } from "@/lib/local/profile";
import type { ProfileInput } from "@/lib/local/profile-schema";
import { generateReviews } from "@/lib/local/reviews";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";

export async function saveProfileAction(projectId: string, input: ProfileInput): Promise<ActionResult<{ saved: true }>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    await saveProfile(project.id, input);
    return { ok: true, data: { saved: true } };
  } catch (e) {
    return actionError(e);
  }
}

export async function distributeAction(projectId: string, directories?: string[]): Promise<ActionResult<{ jobId: string; count: number }>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    const stored = await getProfile(project.id);
    if (!stored) throw new AppError("Save your business profile first.");
    const running = await query<{ id: string }>("SELECT id FROM jobs WHERE project_id=$1 AND kind='local.distribute' AND status IN ('queued','running') LIMIT 1", [project.id]);
    if (running.length) throw new AppError("An update is already being distributed.", 409);
    const view = buildListings(project, stored.profile, await listingRows(project.id));
    const targets = distributionTargets(view, directories);
    if (!targets.length) throw new AppError("All listings are already in sync.");
    const job = await enqueue({ kind: "local.distribute", ownerId: user.id, projectId: project.id, payload: { directories: targets.map((t) => t.id) } });
    return { ok: true, data: { jobId: job.id, count: targets.length } };
  } catch (e) {
    return actionError(e);
  }
}

export async function startScanAction(projectId: string, input: { keywords: string[]; grid: number; radiusKm: number }): Promise<ActionResult<{ scanId: string; jobId: string }>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    const stored = await getProfile(project.id);
    if (!stored) throw new AppError("Add your business profile in Listing Management first: the scan needs a location and category.");
    if (!GRID_SIZES.includes(input.grid as GridSize)) throw new AppError("Choose a valid grid size.");
    const res = await createScan({ ownerId: user.id, project, profile: stored.profile, center: businessLocation(stored.profile, project.country), keywords: input.keywords, grid: input.grid as GridSize, radiusKm: Number(input.radiusKm) });
    return { ok: true, data: { scanId: res.id, jobId: res.jobId } };
  } catch (e) {
    return actionError(e);
  }
}

export async function deleteScanAction(projectId: string, scanId: string): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    await deleteScan(project.id, scanId);
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function scanScheduleAction(projectId: string, input: { enabled: boolean; keywords: string[]; grid: number; radiusKm: number }): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    if (input.enabled && !input.keywords.length) throw new AppError("Run a scan first so the schedule knows which keywords to track.");
    const current = await getSchedule(project.id, "local.map-scan");
    await setSchedule(project.id, "local.map-scan", {
      cadence: "weekly",
      enabled: input.enabled,
      payload: input.enabled ? { keywords: input.keywords.slice(0, 5), grid: input.grid, radiusKm: input.radiusKm } : (current?.payload ?? {}),
    });
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function saveReplyAction(projectId: string, reviewId: string, body: string, status: "draft" | "posted"): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    const stored = await getProfile(project.id);
    if (!stored) throw new AppError("Business profile not found.");
    const text = body.trim();
    if (text.length < 5) throw new AppError("Write a reply of at least a few words.");
    if (text.length > 4000) throw new AppError("Replies are limited to 4,000 characters.");
    if (!["draft", "posted"].includes(status)) throw new AppError("Invalid status.");
    if (!generateReviews(project, stored.profile).some((r) => r.id === reviewId)) throw new AppError("Review not found.", 404);
    await query(
      `INSERT INTO local_review_replies(project_id,review_id,body,status,updated_at) VALUES($1,$2,$3,$4,now())
       ON CONFLICT(project_id,review_id) DO UPDATE SET body=excluded.body, status=excluded.status, updated_at=now()`,
      [project.id, reviewId, text, status],
    );
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function deleteReplyAction(projectId: string, reviewId: string): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, projectId);
    await query("DELETE FROM local_review_replies WHERE project_id=$1 AND review_id=$2", [project.id, reviewId]);
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
