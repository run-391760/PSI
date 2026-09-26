"use server";

import { refresh } from "next/cache";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { rateLimit, requireUser } from "@/lib/auth";
import { addLink, removeLink, saveLbSetup, saveTemplate, setProspectState, startVerification, updatePipelineRow } from "@/lib/backlinks/link-building";
import { OUTREACH_STATUSES, type OutreachStatus } from "@/lib/backlinks/types";
import { AppError } from "@/lib/domain";
import { getProject } from "@/lib/projects";

const strings = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)) : []);

export async function saveLbSetupAction(projectId: string, input: { keywords: string[]; competitors: string[] }): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    await saveLbSetup(user.id, projectId, { keywords: strings(input?.keywords), competitors: strings(input?.competitors) });
    refresh();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function saveTemplateAction(projectId: string, input: { subject: string; body: string; senderName: string }): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    await saveTemplate(user.id, projectId, { subject: String(input?.subject ?? ""), body: String(input?.body ?? ""), senderName: String(input?.senderName ?? "") });
    refresh();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function setProspectStateAction(projectId: string, domains: string[], state: "in_progress" | "rejected" | null): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requireUser();
    if (state !== null && state !== "in_progress" && state !== "rejected") throw new AppError("Invalid state.");
    const project = await getProject(user.id, projectId);
    const count = await setProspectState(user.id, project, strings(domains), state);
    refresh();
    return { ok: true, data: { count } };
  } catch (e) {
    return actionError(e);
  }
}

export async function updatePipelineAction(projectId: string, domain: string, patch: { status?: OutreachStatus; contactName?: string; contactEmail?: string; notes?: string }): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    if (patch.status && !OUTREACH_STATUSES.includes(patch.status)) throw new AppError("Invalid status.");
    await updatePipelineRow(user.id, projectId, String(domain), {
      status: patch.status,
      contactName: patch.contactName === undefined ? undefined : String(patch.contactName),
      contactEmail: patch.contactEmail === undefined ? undefined : String(patch.contactEmail),
      notes: patch.notes === undefined ? undefined : String(patch.notes),
    });
    refresh();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function addLinkAction(projectId: string, input: { sourceUrl: string; prospectDomain?: string | null }): Promise<ActionResult<{ id: string; jobId: string }>> {
  try {
    const user = await requireUser();
    await rateLimit(`lb-add-link:${user.id}`, 60, 60);
    const data = await addLink(user.id, projectId, { sourceUrl: String(input?.sourceUrl ?? ""), prospectDomain: input?.prospectDomain ? String(input.prospectDomain) : null });
    refresh();
    return { ok: true, data };
  } catch (e) {
    return actionError(e);
  }
}

export async function removeLinkAction(projectId: string, id: string): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    await removeLink(user.id, projectId, String(id));
    refresh();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function verifyLinksAction(projectId: string, linkIds?: string[]): Promise<ActionResult<{ jobId: string }>> {
  try {
    const user = await requireUser();
    await rateLimit(`lb-verify:${user.id}`, 20, 60);
    await getProject(user.id, projectId);
    const jobId = await startVerification(user.id, projectId, linkIds?.length ? strings(linkIds) : undefined);
    refresh();
    return { ok: true, data: { jobId } };
  } catch (e) {
    return actionError(e);
  }
}
