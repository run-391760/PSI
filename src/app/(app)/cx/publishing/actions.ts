"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { aiConfigured } from "@/lib/cx/ai";
import { completeOrThrow } from "@/lib/providers/llm";
import { inflateRawSync } from "node:zlib";
import { parseBulkCsv, parseBulkTable, pubChannel, type Utm } from "@/lib/cx/publishing/core";
import * as d from "@/lib/cx/publishing/data";
import { deletePublishedPost } from "@/lib/cx/publishing/dispatch";
import { generateImage, imageGenConfigured } from "@/lib/cx/publishing/adapters";
import { readXlsx } from "@/lib/cx/publishing/xlsx";

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
export type BulkPreviewRow = { line: number; at: string; channels: string[]; text: string; postType: string; error: string | null };
/**
 * Bulk scheduling from CSV text or an .xlsx file (base64). `dryRun` validates and returns per-row status
 * without creating posts; otherwise valid rows are created and invalid rows reported by line.
 */
export async function bulkUploadAction(brandId: string, file: { csv?: string; xlsx?: string } | string, tzOffset: number, dryRun = false) {
  return run(async (u) => {
    const a = await d.requireBrand(u.id, brandId, "author");
    const src = typeof file === "string" ? { csv: file } : file;
    let parsed;
    if (src.xlsx) {
      if (src.xlsx.length > 7_000_000) throw new AppError("The spreadsheet is larger than 5 MB.");
      let table: string[][];
      try {
        table = readXlsx(new Uint8Array(Buffer.from(src.xlsx, "base64")), (b) => new Uint8Array(inflateRawSync(b)));
      } catch (e) {
        throw new AppError(e instanceof Error ? `Could not read the spreadsheet: ${e.message}` : "Could not read the spreadsheet.");
      }
      parsed = parseBulkTable(table, tzOffset);
    } else {
      if ((src.csv ?? "").length > 1_000_000) throw new AppError("The CSV is larger than 1 MB.");
      parsed = parseBulkCsv(src.csv ?? "", tzOffset);
    }
    const { rows, errors } = parsed;
    if (rows.length > 500) throw new AppError("Upload at most 500 posts at a time.");
    const rowErrors = dryRun ? await d.bulkCheck(a, rows) : [];
    const preview: BulkPreviewRow[] = [
      ...rows.map((r) => ({ line: r.line, at: r.at, channels: r.channels, text: r.text.slice(0, 140), postType: r.postType, error: rowErrors.find((e) => e.line === r.line)?.error ?? null })),
      ...errors.map((e) => ({ line: e.line, at: "", channels: [], text: "", postType: "", error: e.error })),
    ].sort((x, y) => x.line - y.line);
    if (dryRun) return { created: 0, pendingApproval: false, errors: [...errors, ...rowErrors].sort((x, y) => x.line - y.line), preview, valid: rows.length - rowErrors.length };
    const r = rows.length ? await d.bulkCreate(a, u.id, rows, await origin()) : { created: 0, pendingApproval: false, errors: [] };
    const all = [...errors, ...r.errors].sort((x, y) => x.line - y.line);
    return { created: r.created, pendingApproval: r.pendingApproval, errors: all, preview: preview.map((p) => ({ ...p, error: p.error ?? r.errors.find((e) => e.line === p.line)?.error ?? null })), valid: rows.length };
  });
}

export async function deletePublishedAction(brandId: string, postId: string, kind: string) {
  return run(async (u) => deletePublishedPost(await d.requireBrand(u.id, brandId, "author"), u, postId, kind));
}

/** Prompt-based compose: a full post draft from a prompt (null data = no AI key configured). */
export async function composeFromPromptAction(brandId: string, input: { prompt: string; channel: string; postType: string }) {
  return run(async (u) => {
    const a = await d.requireBrand(u.id, brandId, "author");
    if (!input.prompt.trim()) throw new AppError("Describe the post you want.");
    const ch = pubChannel(input.channel);
    // A null result means no key; a configured provider that fails surfaces its error instead.
    if (!aiConfigured()) return null;
    const { text: out } = await completeOrThrow(
      `You write social media posts for the brand "${a.brand.name}" (${a.brand.domain}). Write one ${input.postType === "poll" ? "poll question (the options go on separate lines after a line containing exactly ---)" : "post"} for ${ch?.name ?? "social media"} within ${Math.min(ch?.limit ?? 2200, 2200)} characters. Use only facts given in the prompt; never invent prices, dates, statistics or claims. Where a link belongs write {link}. Return only the post text.`,
      input.prompt.slice(0, 4000),
      { maxTokens: 900 },
    );
    const [text, opts] = out.split(/\n\s*---\s*\n/);
    return { text: text.trim(), pollOptions: opts ? opts.split("\n").map((s) => s.replace(/^[-*\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 4) : [] };
  });
}

/** AI image generation into the asset library (null data = no image API key configured). */
export async function generateImageAction(brandId: string, input: { prompt: string; size: string }) {
  return run(async (u) => {
    const a = await d.requireBrand(u.id, brandId, "author");
    if (!imageGenConfigured()) return null;
    if (!input.prompt.trim()) throw new AppError("Describe the image.");
    const png = await generateImage(input.prompt, input.size).catch((e) => {
      throw new AppError(e instanceof Error ? e.message : "Image generation failed.");
    });
    if (!png) return null;
    const name = `ai-${input.prompt.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/-+$/, "")}.png`;
    return d.storeAsset(a.brand.id, u.id, { name, type: "image/png", bytes: png }, ["ai-generated"], "ai");
  });
}

/** AI caption suggestions (null data = no AI key configured). */
export async function suggestCaptionsAction(brandId: string, input: { text: string; channel: string; brief: string }) {
  return run(async (u) => {
    const a = await d.requireBrand(u.id, brandId, "author");
    const ch = pubChannel(input.channel);
    const limit = ch?.limit ?? 2200;
    if (!aiConfigured()) return null;
    const { text: out } = await completeOrThrow(
      `You write social media captions for the brand "${a.brand.name}" (${a.brand.domain}). Write 3 alternative captions for ${ch?.name ?? "social media"} (hard limit ${Math.min(limit, 2200)} characters each${input.channel === "x" ? "; links count as 23" : ""}). Keep facts from the draft; never invent prices, dates, statistics or claims. Keep a {link} placeholder where the draft has one. Match the channel's style. Return only the 3 captions separated by a line containing exactly ---.`,
      `Brief: ${input.brief || "(none)"}\n\nDraft:\n${input.text || "(empty)"}`,
      { maxTokens: 1200 },
    );
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
export async function requestAssetApprovalAction(brandId: string, id: string, approverId: string | null, note: string) {
  return run(async (u) => d.requestAssetApproval(await d.requireBrand(u.id, brandId, "author"), u, id, approverId, note));
}
export async function decideAssetAction(brandId: string, id: string, decision: "approved" | "rejected", note: string) {
  return run(async (u) => d.decideAsset(await d.requireBrand(u.id, brandId, "approve"), u, id, decision, note));
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
export async function savePubSettingsAction(brandId: string, patch: { quotaMb?: number; requireAssetApproval?: boolean; tagPolicy?: "authors" | "managers"; failureEmail?: boolean }) {
  return run(async (u) => d.saveSettings((await d.requireBrand(u.id, brandId, "owner")).brand.id, patch));
}
/** Content-tag list: tag managers (owner, team admins, 'tagger' role) only. */
export async function saveContentTagsAction(brandId: string, tags: string[]) {
  return run(async (u) => {
    const a = await d.requireBrand(u.id, brandId);
    if (!a.isTagManager) throw new AppError("Only content-tag managers can edit the tag list.", 403);
    await d.saveSettings(a.brand.id, { contentTags: tags });
  });
}
export async function addMemberAction(brandId: string, email: string, role: "author" | "approver" | "tagger") {
  return run(async (u) => d.addMember((await d.requireBrand(u.id, brandId, "owner")).brand, email, role));
}
export async function removeMemberAction(brandId: string, userId: string, role: string) {
  return run(async (u) => d.removeMember((await d.requireBrand(u.id, brandId, "owner")).brand, userId, role));
}
export async function setRequireApprovalAction(brandId: string, on: boolean) {
  return run(async (u) => d.setRequireApproval((await d.requireBrand(u.id, brandId, "owner")).brand.id, on));
}
