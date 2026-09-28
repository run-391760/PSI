"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { suggestReply } from "@/lib/cx/ai";
import { classifyTicket } from "@/lib/cx/admin/fields";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { useCanned } from "@/lib/cx/inbox/automation";
import { postReply, sendSurveysOnSolve, type Delivery, type ReplyInput } from "@/lib/cx/inbox/dispatch";
import { brandUser } from "@/lib/cx/inbox/guard";
import type { InboxPrefs, InboxSettings } from "@/lib/cx/inbox/model";
import { saveInboxSettings, savePrefs } from "@/lib/cx/inbox/settings";
import { createTicket, getTicket, mergeTickets, updateTickets, type TicketPatch } from "@/lib/cx/inbox/store";
import {
  aiRewrite, assignWithNote, createChildTicket, deleteReminder, linkParent, saveReminder, saveSignature, sendTicketEmail, summarizeTicket, translateMessage, unlinkParent, type EmailInput,
} from "@/lib/cx/inbox/workspace";

async function run<T>(brand: string, fn: (u: { id: string; name: string; email: string }, role: string) => Promise<T>, opts: { write?: boolean; revalidate?: boolean } = {}): Promise<ActionResult<T>> {
  try {
    const { user, project } = await brandUser(brand, { write: opts.write !== false });
    const data = await fn(user, project.role);
    if (opts.revalidate !== false) revalidatePath("/cx/inbox");
    return { ok: true, data };
  } catch (e) {
    return actionError(e);
  }
}

export async function updateTicketsAction(brand: string, ids: string[], patch: TicketPatch): Promise<ActionResult<number>> {
  return run(brand, async (user) => {
    const n = await updateTickets(brand, ids.slice(0, 500), patch, user.name);
    if (patch.status === "solved") await sendSurveysOnSolve(brand, ids.slice(0, 500), user.name);
    return n;
  });
}

export async function replyAction(brand: string, ticketId: string, input: ReplyInput): Promise<ActionResult<Delivery>> {
  return run(brand, async (user) => {
    const r = await postReply(brand, ticketId, user, input);
    if (input.status === "solved" && !input.note) await sendSurveysOnSolve(brand, [ticketId], user.name);
    return r;
  });
}

export async function mergeAction(brand: string, targetId: string, sourceIds: string[], numbers: number[] = []): Promise<ActionResult<number>> {
  return run(brand, async (user) => {
    const ids = [...sourceIds];
    if (numbers.length) {
      const rows = await query<{ id: string; number: number }>("SELECT id,number FROM cx_tickets WHERE project_id=$1 AND number = ANY($2)", [brand, numbers]);
      const missing = numbers.filter((n) => !rows.some((r) => r.number === n));
      if (missing.length) throw new AppError(`Ticket ${missing.map((n) => `#${n}`).join(", ")} not found.`);
      ids.push(...rows.map((r) => r.id));
    }
    return mergeTickets(brand, targetId, ids, user.name);
  });
}

export async function suggestReplyAction(brand: string, ticketId: string): Promise<ActionResult<string | null>> {
  return run(brand, async (_u, _r) => {
    const { project } = await brandUser(brand);
    const d = await getTicket(brand, ticketId);
    if (!d) throw new AppError("Ticket not found.", 404);
    const conversation = d.messages.filter((m) => m.direction !== "note").slice(-20).map((m) => ({ from: m.direction === "in" ? ("customer" as const) : ("agent" as const), text: m.body.slice(0, 3000) }));
    return suggestReply({ brand: project.name, conversation });
  }, { revalidate: false });
}

export async function cannedUsedAction(brand: string, id: string): Promise<ActionResult<null>> {
  return run(brand, async () => { await useCanned(brand, id); return null; }, { revalidate: false });
}

export async function newTicketAction(brand: string, input: { name: string; email: string; phone: string; subject: string; body: string; channel: string }): Promise<ActionResult<{ id: string; number: number }>> {
  return run(brand, async (user) => {
    if (!input.subject.trim() || !input.body.trim()) throw new AppError("Subject and description are required.");
    if (!input.name.trim() && !input.email.trim() && !input.phone.trim()) throw new AppError("Add the customer's name, email or phone.");
    if (input.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) throw new AppError("Enter a valid email address.");
    const channel = ["phone", "email", "webform", "livechat", "other"].includes(input.channel) ? input.channel : "other";
    const r = await createTicket({
      projectId: brand, channelKind: channel, contact: { name: input.name || null, email: input.email || null, phone: input.phone || null },
      subject: input.subject.trim(), body: input.body.trim(), authorName: input.name.trim() || input.email.trim() || input.phone.trim(),
    });
    await updateTickets(brand, [r.id], { status: "open" }, user.name);
    return { id: r.id, number: r.number };
  });
}

// ---------------------------------------------------------------- reminders, parent–child, assignment, email

export const saveReminderAction = async (brand: string, input: { id?: string; ticketId: string; remindAt: string; note: string; userIds: string[] }) =>
  run(brand, async (u) => { await saveReminder(brand, u, input); return null; });
export const deleteReminderAction = async (brand: string, id: string) => run(brand, async (u) => { await deleteReminder(brand, u, id); return null; });

export const createChildAction = async (brand: string, parentId: string, input: { subject: string; body: string; assigneeId?: string | null }) =>
  run(brand, (u) => createChildTicket(brand, parentId, u, input));
export const linkParentAction = async (brand: string, childId: string, parentNumber: number) => run(brand, async (u) => { await linkParent(brand, childId, parentNumber, u.name); return null; });
export const unlinkParentAction = async (brand: string, childId: string) => run(brand, async (u) => { await unlinkParent(brand, childId, u.name); return null; });

export const assignAction = async (brand: string, ticketId: string, input: { assigneeId: string | null; note: string; attachmentIds: string[] }) =>
  run(brand, async (u) => { await assignWithNote(brand, ticketId, u, input); return null; });

export const sendEmailAction = async (brand: string, ticketId: string, input: EmailInput) => run(brand, (u) => sendTicketEmail(brand, ticketId, u, input));

export const classifyAction = async (brand: string, ticketId: string, input: { classificationIds?: string[]; values?: Record<string, unknown> }) =>
  run(brand, async (u) => { await classifyTicket(brand, ticketId, input, u.id); return null; });

// ---------------------------------------------------------------- personal settings, ticket settings

export const savePrefsAction = async (brand: string, patch: Partial<InboxPrefs>) => run(brand, (u) => savePrefs(u.id, patch), { write: false });
export const saveSignatureAction = async (brand: string, input: { body: string; imageFileId: string | null; enabled: boolean }) =>
  run(brand, async (u) => { await saveSignature(brand, u.id, input); return null; });
export const saveSettingsAction = async (brand: string, patch: Partial<InboxSettings>) =>
  run(brand, async (_u, role) => {
    if (!["owner", "admin"].includes(role)) throw new AppError("Only brand admins can change ticket settings.", 403);
    return saveInboxSettings(brand, patch);
  });

// ---------------------------------------------------------------- AI helpers (null when no AI key)

export const aiRewriteAction = async (brand: string, kind: "grammar" | "translate", text: string, lang?: string) => run(brand, () => aiRewrite(kind, text, lang), { revalidate: false });
export const translateMessageAction = async (brand: string, messageId: string, lang: string) => run(brand, () => translateMessage(brand, messageId, lang), { write: false, revalidate: false });
export const summarizeAction = async (brand: string, ticketId: string) => run(brand, () => summarizeTicket(brand, ticketId), { write: false, revalidate: false });
