"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { complete } from "@/lib/cx/ai";
import { parseBulkCsv, pubChannel, type Utm } from "@/lib/cx/publishing/core";
import * as d from "@/lib/cx/publishing/data";

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AppError) return { ok: false, error: e.message };
  if (e instanceof Error && /URL|http/.test(e.message)) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. Please try again." };
}
async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
function run<T>(fn: (user: Awaited<ReturnType<typeof requireUser>>) => Promise<T>): Promise<Result<T>> {
  return requireUser()
    .then(async (user) => {
      const data = await fn(user);
      revalidatePath("/cx/publishing", "layout");
      revalidatePath("/cx/analytics");
      return { ok: true as const, data };
    })
    .catch(fail);
}

// ---------------------------------------------------------------- posts

export async function savePostAction(brandId: string, input: d.PostInput) {
  return run(async (u) => d.savePost(await d.requireBrand(u.id, brandId, "author"), u.id, input, await origin()));
}
export async function transitionAction(brandId: string, postId: string, action: "submit" | "approve" | "reject" | "schedule" | "unschedule" | "publish_now" | "retry", comment = "", at?: string) {
  return run(async (u) => d.transition(await d.requireBrand(u.id, brandId, action === "approve" || action === "reject" ? "approve" : "author"), u, postId, action, comment, at));
}
export async function reschedulePostAction(brandId: string, postId: string, at: string) {
  return run(async (u) => d.reschedule((await d.requireBrand(u.id, brandId, "author")).brand.id, postId, at));
}
export async function markManualAction(brandId: string, postId: string, kind: string, url: string) {
  return run(async (u) => d.markManual((await d.requireBrand(u.id, brandId, "author")).brand.id, u, postId, kind, url.trim()));
}
export async function deletePostAction(brandId: string, postId: string) {
  return run(async (u) => d.deletePost((await d.requireBrand(u.id, brandId, "author")).brand.id, postId));
}
export async function duplicatePostAction(brandId: string, postId: string) {
  return run(async (u) => d.duplicatePost(await d.requireBrand(u.id, brandId, "author"), u.id, postId, await origin()));
}
export async function commentAction(brandId: string, postId: string, body: string) {
  return run(async (u) => {
    const a = await d.requireBrand(u.id, brandId);
    await d.getPost(a.brand.id, postId);
    if (!body.trim()) throw new AppError("Write a comment.");
    await d.addComment(postId, u, "comment", body.trim());
  });
}
export async function bulkUploadAction(brandId: string, csv: string, tzOffset: number) {
  return run(async (u) => {
    const a = await d.requireBrand(u.id, brandId, "author");
    if (csv.length > 1_000_000) throw new AppError("The CSV is larger than 1 MB.");
    const { rows, errors } = parseBulkCsv(csv, tzOffset);
    if (rows.length > 500) throw new AppError("Upload at most 500 posts at a time.");
    const r = rows.length ? await d.bulkCreate(a, u.id, rows, await origin()) : { created: 0, pendingApproval: false };
    return { ...r, errors };
  });
}

/** AI caption suggestions (null data = no AI key configured). */
export async function suggestCaptionsAction(brandId: string, input: { text: string; channel: string; brief: string }) {
  return run(async (u) => {
    const a = await d.requireBrand(u.id, brandId, "author");
    const ch = pubChannel(input.channel);
    const limit = ch?.limit ?? 2200;
    const out = await complete(
      `You write social media captions for the brand "${a.brand.name}" (${a.brand.domain}). Write 3 alternative captions for ${ch?.name ?? "social media"} (hard limit ${Math.min(limit, 2200)} characters each${input.channel === "x" ? "; links count as 23" : ""}). Keep facts from the draft; never invent prices, dates, statistics or claims. Keep a {link} placeholder where the draft has one. Match the channel's style. Return only the 3 captions separated by a line containing exactly ---.`,
      `Brief: ${input.brief || "(none)"}\n\nDraft:\n${input.text || "(empty)"}`,
      1200,
    );
    if (out === null) return null;
    return out.split(/\n\s*---\s*\n/).map((s) => s.trim()).filter(Boolean).slice(0, 3);
  });
}

// ---------------------------------------------------------------- links, campaigns, assets

export async function createLinkAction(brandId: string, input: { url: string; utm: Utm; label: string; campaignId: string | null }) {
  return run(async (u) => {
    const a = await d.requireBrand(u.id, brandId, "author");
    const r = await d.createLink(a.brand.id, { url: input.url, utm: input.utm, label: input.label, campaignId: input.campaignId, channel: input.utm.source?.trim() || null });
    return { ...r, short: d.shortUrl(await origin(), r.code) };
  });
}
export async function deleteLinkAction(brandId: string, id: string) {
  return run(async (u) => d.deleteLink((await d.requireBrand(u.id, brandId, "author")).brand.id, id));
}
export async function saveCampaignAction(brandId: string, input: { id?: string; name: string; color: number; starts_on: string | null; ends_on: string | null; notes: string }) {
  return run(async (u) => d.saveCampaign((await d.requireBrand(u.id, brandId, "author")).brand.id, input));
}
export async function deleteCampaignAction(brandId: string, id: string) {
  return run(async (u) => d.deleteCampaign((await d.requireBrand(u.id, brandId, "author")).brand.id, id));
}
export async function setAssetTagsAction(brandId: string, id: string, tags: string[]) {
  return run(async (u) => d.setAssetTags((await d.requireBrand(u.id, brandId, "author")).brand.id, id, tags));
}
export async function deleteAssetAction(brandId: string, id: string) {
  return run(async (u) => d.deleteAsset((await d.requireBrand(u.id, brandId, "author")).brand.id, id));
}

// ---------------------------------------------------------------- settings (owner)

export async function saveAccountAction(brandId: string, kind: string, externalId: string, label: string, token: string) {
  return run(async (u) => d.saveAccount((await d.requireBrand(u.id, brandId, "owner")).brand.id, kind, externalId, label, token || null));
}
export async function removeAccountAction(brandId: string, kind: string) {
  return run(async (u) => d.removeAccount((await d.requireBrand(u.id, brandId, "owner")).brand.id, kind));
}
export async function addMemberAction(brandId: string, email: string, role: "author" | "approver") {
  return run(async (u) => d.addMember((await d.requireBrand(u.id, brandId, "owner")).brand, email, role));
}
export async function removeMemberAction(brandId: string, userId: string, role: string) {
  return run(async (u) => d.removeMember((await d.requireBrand(u.id, brandId, "owner")).brand, userId, role));
}
export async function setRequireApprovalAction(brandId: string, on: boolean) {
  return run(async (u) => d.setRequireApproval((await d.requireBrand(u.id, brandId, "owner")).brand.id, on));
}
