"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { getCxBrand } from "@/lib/cx/context";
import { aiConfigured } from "@/lib/cx/ai";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { createShareLink, revokeShareLink } from "@/lib/cx/insights/dashboards";
import { generateBrief, groundedReply, saveAiSettings } from "@/lib/cx/insights/intelligence";
import { aiSignalOverride } from "@/lib/cx/insights/signals";
import { syncHourly } from "@/lib/cx/insights/schedule";
import type { KbHit } from "@/lib/cx/insights/kb";
import { deleteSession, renameSession, sendMessage } from "@/lib/cx/insights/assistant";
import { addVaultDoc, deleteVaultDoc } from "@/lib/cx/insights/vault";

async function brand(projectId: string, write = true) {
  const user = await requireUser();
  await getCxBrand(user.id, projectId, { write });
  return user;
}
const needAi = () => {
  if (!aiConfigured()) throw new AppError("Connect an AI key (Anthropic, OpenAI, Gemini or Sarvam) on the server to use this.", 400);
};

export async function briefSettingsAction(projectId: string, cadence: "off" | "weekly" | "monthly", recipients: string[]): Promise<ActionResult<null>> {
  try {
    await brand(projectId);
    const bad = recipients.find((r) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));
    if (bad) throw new AppError(`“${bad}” is not a valid email address.`, 400);
    await saveAiSettings(projectId, { cadence, recipients: recipients.slice(0, 20) });
    await syncHourly(projectId);
    revalidatePath("/cx/ask");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function briefNowAction(projectId: string, period: "weekly" | "monthly"): Promise<ActionResult<{ body: string }>> {
  try {
    await brand(projectId);
    needAi();
    const r = await generateBrief(projectId, period);
    if (!r) throw new AppError("The AI did not return a brief. Try again.", 502);
    revalidatePath("/cx/ask");
    return { ok: true, data: { body: r.body } };
  } catch (e) {
    return actionError(e);
  }
}

export async function connectorTokenAction(projectId: string, label: string): Promise<ActionResult<{ token: string }>> {
  try {
    const user = await brand(projectId);
    const token = await createShareLink(projectId, user.id, "mcp", null, label || "MCP connector");
    revalidatePath("/cx/ask");
    return { ok: true, data: { token } };
  } catch (e) {
    return actionError(e);
  }
}
export async function revokeConnectorAction(projectId: string, token: string): Promise<ActionResult<null>> {
  try {
    await brand(projectId);
    await revokeShareLink(projectId, token);
    revalidatePath("/cx/ask");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function aiSignalAction(projectId: string, ticketId: string): Promise<ActionResult<{ csat: number; churn: number; reason: string }>> {
  try {
    await brand(projectId, false);
    needAi();
    const r = await aiSignalOverride(projectId, ticketId);
    if (!r) throw new AppError("The AI could not assess this ticket.", 502);
    return { ok: true, data: r };
  } catch (e) {
    return actionError(e);
  }
}

/** For the inbox (WP1): KB-grounded reply suggestion with sources. `text` is null when AI is off. */
export async function groundedReplyAction(projectId: string, ticketId: string): Promise<ActionResult<{ text: string | null; sources: KbHit[]; ai: boolean }>> {
  try {
    await brand(projectId, false);
    return { ok: true, data: await groundedReply(projectId, ticketId) };
  } catch (e) {
    return actionError(e);
  }
}

// ------------------------------------------------------------------ AI assistant (sessions + vault)

export async function assistantSendAction(projectId: string, sessionId: string | null, message: string): Promise<ActionResult<{ sessionId: string }>> {
  try {
    const user = await brand(projectId, false);
    needAi();
    const r = await sendMessage(projectId, user.id, sessionId, message);
    revalidatePath("/cx/ask");
    return { ok: true, data: { sessionId: r.sessionId } };
  } catch (e) {
    return actionError(e);
  }
}

export async function assistantRenameAction(projectId: string, sessionId: string, title: string): Promise<ActionResult<null>> {
  try {
    const user = await brand(projectId, false);
    await renameSession(projectId, user.id, sessionId, title);
    revalidatePath("/cx/ask");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function assistantDeleteAction(projectId: string, sessionId: string): Promise<ActionResult<null>> {
  try {
    const user = await brand(projectId, false);
    await deleteSession(projectId, user.id, sessionId);
    revalidatePath("/cx/ask");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

/** Add pasted text to the knowledge vault (files go through POST /api/cx/assistant/vault). */
export async function vaultPasteAction(projectId: string, title: string, text: string): Promise<ActionResult<{ chunks: number }>> {
  try {
    const user = await brand(projectId);
    const r = await addVaultDoc(projectId, user.id, { title, text });
    revalidatePath("/cx/ask");
    return { ok: true, data: { chunks: r.chunks } };
  } catch (e) {
    return actionError(e);
  }
}

export async function vaultDeleteAction(projectId: string, docId: string): Promise<ActionResult<null>> {
  try {
    await brand(projectId);
    await deleteVaultDoc(projectId, docId);
    revalidatePath("/cx/ask");
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
