"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { getCxBrand } from "@/lib/cx/context";
import { aiConfigured } from "@/lib/cx/ai";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { createShareLink, revokeShareLink } from "@/lib/cx/insights/dashboards";
import { askMetrics, generateBrief, groundedReply, saveAiSettings } from "@/lib/cx/insights/intelligence";
import { aiSignalOverride } from "@/lib/cx/insights/signals";
import { syncHourly } from "@/lib/cx/insights/schedule";
import type { KbHit } from "@/lib/cx/insights/kb";

async function brand(projectId: string, write = true) {
  const user = await requireUser();
  await getCxBrand(user.id, projectId, { write });
  return user;
}
const needAi = () => {
  if (!aiConfigured()) throw new AppError("Connect an AI key (ANTHROPIC_API_KEY or OPENAI_API_KEY) to use this.", 400);
};

export async function askAction(projectId: string, question: string, days: number): Promise<ActionResult<{ answer: string }>> {
  try {
    const user = await brand(projectId, false);
    needAi();
    if (!question.trim()) throw new AppError("Ask a question.", 400);
    const r = await askMetrics(projectId, user.id, question, [7, 30, 90].includes(days) ? days : 30);
    if (!r) throw new AppError("The AI did not return an answer. Try again.", 502);
    revalidatePath("/cx/ask");
    return { ok: true, data: { answer: r.answer } };
  } catch (e) {
    return actionError(e);
  }
}

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
