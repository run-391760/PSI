"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/app/(app)/projects/actions";
import { suggestReply } from "@/lib/cx/ai";
import { query } from "@/lib/db";
import { useCanned } from "@/lib/cx/inbox/automation";
import { postReply, sendSurveysOnSolve, type Delivery } from "@/lib/cx/inbox/dispatch";
import { brandUser } from "@/lib/cx/inbox/guard";
import { createTicket, getTicket, mergeTickets, updateTickets, type Status, type TicketPatch } from "@/lib/cx/inbox/store";

export async function updateTicketsAction(brand: string, ids: string[], patch: TicketPatch): Promise<ActionResult<number>> {
  try {
    const { user } = await brandUser(brand);
    const n = await updateTickets(brand, ids.slice(0, 500), patch, user.name);
    if (patch.status === "solved") await sendSurveysOnSolve(brand, ids.slice(0, 500), user.name);
    revalidatePath("/cx/inbox");
    return { ok: true, data: n };
  } catch (e) {
    return actionError(e);
  }
}

export async function replyAction(brand: string, ticketId: string, body: string, note: boolean, status: Status | null): Promise<ActionResult<Delivery>> {
  try {
    const { user } = await brandUser(brand);
    const r = await postReply(brand, ticketId, user, { body, note, status });
    if (status === "solved" && !note) await sendSurveysOnSolve(brand, [ticketId], user.name);
    revalidatePath("/cx/inbox");
    return { ok: true, data: r };
  } catch (e) {
    return actionError(e);
  }
}

export async function mergeAction(brand: string, targetId: string, sourceIds: string[], numbers: number[] = []): Promise<ActionResult<number>> {
  try {
    const { user } = await brandUser(brand);
    const ids = [...sourceIds];
    if (numbers.length) {
      const rows = await query<{ id: string; number: number }>("SELECT id,number FROM cx_tickets WHERE project_id=$1 AND number = ANY($2)", [brand, numbers]);
      const missing = numbers.filter((n) => !rows.some((r) => r.number === n));
      if (missing.length) return { ok: false, error: `Ticket ${missing.map((n) => `#${n}`).join(", ")} not found.` };
      ids.push(...rows.map((r) => r.id));
    }
    const n = await mergeTickets(brand, targetId, ids, user.name);
    revalidatePath("/cx/inbox");
    return { ok: true, data: n };
  } catch (e) {
    return actionError(e);
  }
}

export async function suggestReplyAction(brand: string, ticketId: string): Promise<ActionResult<string | null>> {
  try {
    const { project } = await brandUser(brand);
    const d = await getTicket(brand, ticketId);
    if (!d) return { ok: false, error: "Ticket not found." };
    const conversation = d.messages.filter((m) => m.direction !== "note").slice(-20).map((m) => ({ from: m.direction === "in" ? ("customer" as const) : ("agent" as const), text: m.body.slice(0, 3000) }));
    const text = await suggestReply({ brand: project.name, conversation });
    return { ok: true, data: text };
  } catch (e) {
    return actionError(e);
  }
}

export async function cannedUsedAction(brand: string, id: string): Promise<ActionResult<null>> {
  try {
    await brandUser(brand);
    await useCanned(brand, id);
    return { ok: true, data: null };
  } catch (e) {
    return actionError(e);
  }
}

export async function newTicketAction(brand: string, input: { name: string; email: string; phone: string; subject: string; body: string; channel: string }): Promise<ActionResult<{ id: string; number: number }>> {
  try {
    const { user } = await brandUser(brand);
    if (!input.subject.trim() || !input.body.trim()) return { ok: false, error: "Subject and description are required." };
    if (!input.name.trim() && !input.email.trim() && !input.phone.trim()) return { ok: false, error: "Add the customer's name, email or phone." };
    if (input.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) return { ok: false, error: "Enter a valid email address." };
    const channel = ["phone", "email", "webform", "livechat", "other"].includes(input.channel) ? input.channel : "other";
    const r = await createTicket({
      projectId: brand, channelKind: channel, contact: { name: input.name || null, email: input.email || null, phone: input.phone || null },
      subject: input.subject.trim(), body: input.body.trim(), authorName: input.name.trim() || input.email.trim() || input.phone.trim(),
    });
    await updateTickets(brand, [r.id], { status: "open" }, user.name);
    revalidatePath("/cx/inbox");
    return { ok: true, data: { id: r.id, number: r.number } };
  } catch (e) {
    return actionError(e);
  }
}
