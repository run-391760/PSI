"use server";

import { refresh } from "next/cache";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { requireUser } from "@/lib/auth";
import { saveAuditSettings, setDomainsList, startAudit, updateRemoveEntry } from "@/lib/backlinks/audit";
import type { AuditList, RemoveStatus } from "@/lib/backlinks/types";
import { AppError } from "@/lib/domain";

const LISTS: (AuditList | null)[] = ["whitelist", "remove", "disavow", null];
const STATUSES: RemoveStatus[] = ["not_sent", "sent", "replied", "removed", "no_response"];

export async function saveAuditSetupAction(projectId: string, input: { brandTerms: string[]; country: string; weekly: boolean }): Promise<ActionResult<{ jobId: string }>> {
  try {
    const user = await requireUser();
    if (!Array.isArray(input?.brandTerms)) throw new AppError("Invalid brand terms.");
    const jobId = await saveAuditSettings(user.id, projectId, { brandTerms: input.brandTerms.map(String), country: String(input.country ?? "US"), weekly: Boolean(input.weekly) });
    refresh();
    return { ok: true, data: { jobId } };
  } catch (e) {
    return actionError(e);
  }
}

export async function runAuditAction(projectId: string): Promise<ActionResult<{ jobId: string }>> {
  try {
    const user = await requireUser();
    const jobId = await startAudit(user.id, projectId, "manual");
    refresh();
    return { ok: true, data: { jobId } };
  } catch (e) {
    return actionError(e);
  }
}

export async function setListAction(projectId: string, domains: string[], list: AuditList | null): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requireUser();
    if (!LISTS.includes(list) || !Array.isArray(domains)) throw new AppError("Invalid list.");
    const count = await setDomainsList(user.id, projectId, domains.map(String), list);
    refresh();
    return { ok: true, data: { count } };
  } catch (e) {
    return actionError(e);
  }
}

export async function updateRemoveAction(projectId: string, domain: string, patch: { contact?: string; status?: RemoveStatus; note?: string }): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    if (patch.status && !STATUSES.includes(patch.status)) throw new AppError("Invalid status.");
    await updateRemoveEntry(user.id, projectId, String(domain), {
      contact: patch.contact === undefined ? undefined : String(patch.contact),
      status: patch.status,
      note: patch.note === undefined ? undefined : String(patch.note),
    });
    refresh();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
