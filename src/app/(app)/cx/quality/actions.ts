"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { getCxBrand } from "@/lib/cx/context";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { aiConfigured } from "@/lib/cx/ai";
import type { QaAnswers } from "@/lib/cx/insights/metrics";
import {
  STARTER_SCORECARD,
  aiPrescore,
  deleteReview,
  deleteScorecard,
  disputeReview,
  openReview,
  resolveDispute,
  sampleForReview,
  saveReview,
  saveScorecard,
  type scorecardInput,
} from "@/lib/cx/insights/quality";

async function brand(projectId: string) {
  const user = await requireUser();
  await getCxBrand(user.id, projectId);
  return user;
}
const done = () => revalidatePath("/cx/quality", "layout");

export async function saveScorecardAction(projectId: string, input: z.input<typeof scorecardInput>, id?: string): Promise<ActionResult<{ id: string }>> {
  try {
    await brand(projectId);
    const sid = await saveScorecard(projectId, input, id);
    done();
    return { ok: true, data: { id: sid } };
  } catch (e) {
    return actionError(e);
  }
}
export async function createStarterScorecardAction(projectId: string): Promise<ActionResult<{ id: string }>> {
  return saveScorecardAction(projectId, STARTER_SCORECARD);
}
export async function deleteScorecardAction(projectId: string, id: string): Promise<ActionResult<null>> {
  try {
    await brand(projectId);
    await deleteScorecard(projectId, id);
    done();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
export async function sampleAction(projectId: string, input: { scorecardId: string; count: number; days: number; agentId?: string; channel?: string }): Promise<ActionResult<{ eligible: number; queued: number }>> {
  try {
    await brand(projectId);
    const r = await sampleForReview(projectId, input.scorecardId, { count: Math.round(input.count), days: Math.min(365, Math.max(1, Math.round(input.days))), agentId: input.agentId || null, channel: input.channel || null });
    done();
    return { ok: true, data: r };
  } catch (e) {
    return actionError(e);
  }
}
export async function openReviewAction(projectId: string, ticketId: string, scorecardId: string): Promise<ActionResult<{ id: string }>> {
  try {
    await brand(projectId);
    const id = await openReview(projectId, ticketId, scorecardId);
    done();
    return { ok: true, data: { id } };
  } catch (e) {
    return actionError(e);
  }
}
export async function saveReviewAction(projectId: string, id: string, input: { answers: QaAnswers; comment: string; coaching: string; submit: boolean }): Promise<ActionResult<{ score: number | null; fatal: boolean; status: string }>> {
  try {
    const user = await brand(projectId);
    const r = await saveReview(projectId, user.id, id, input);
    done();
    return { ok: true, data: { score: r.score, fatal: r.fatal, status: r.status } };
  } catch (e) {
    return actionError(e);
  }
}
export async function aiPrescoreAction(projectId: string, id: string): Promise<ActionResult<{ answers: QaAnswers; notes: Record<string, string>; summary: string }>> {
  try {
    await brand(projectId);
    if (!aiConfigured()) throw new AppError("Connect an AI key (ANTHROPIC_API_KEY or OPENAI_API_KEY) to use AI pre-scoring.", 400);
    const r = await aiPrescore(projectId, id);
    if (!r) throw new AppError("AI is not configured.", 400);
    done();
    return { ok: true, data: r };
  } catch (e) {
    return actionError(e);
  }
}
export async function disputeAction(projectId: string, id: string, reason: string): Promise<ActionResult<null>> {
  try {
    await brand(projectId);
    if (!reason.trim()) throw new AppError("Explain why the review should change.", 400);
    await disputeReview(projectId, id, reason.trim());
    done();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
export async function resolveDisputeAction(projectId: string, id: string, response: string): Promise<ActionResult<null>> {
  try {
    await brand(projectId);
    if (!response.trim()) throw new AppError("Add a response for the agent.", 400);
    await resolveDispute(projectId, id, response.trim());
    done();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
export async function deleteReviewAction(projectId: string, id: string): Promise<ActionResult<null>> {
  try {
    await brand(projectId);
    await deleteReview(projectId, id);
    done();
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}
