"use server";

import type { ActionResult } from "@/app/(app)/projects/actions";
import { AppError } from "@/lib/domain";
import { query } from "@/lib/db";
import { getTicket, type MessageRow } from "@/lib/cx/inbox/store";
import { bulkUpdate, createTicketFromMention, updateMentionLabels } from "@/lib/cx/listening/data";
import { runOps } from "@/lib/cx/ops/run";

const PATHS = ["/cx/messages", "/cx/inbox", "/cx/listening"];

/**
 * Turn a listening mention (cx_mentions) into an inbox ticket and return the ticket id. Idempotent: a mention that
 * already has a ticket returns that ticket (`existing: true`). Open it at `/cx/ticket/<id>?brand=<brand>`.
 * Used by All Messages mention cards and by the report drill-down drawer (WP-K4).
 */
export async function createTicketFromMentionAction(brand: string, mentionId: string): Promise<ActionResult<{ id: string; number: number; existing: boolean }>> {
  return runOps(brand, async () => {
    if (!mentionId || mentionId.length > 64) throw new AppError("Mention not found.", 404);
    const r = await createTicketFromMention(brand, mentionId);
    return { id: r.ticketId, number: r.number, existing: r.existing };
  }, { paths: PATHS });
}

/** Mark mentions read / actioned / ignored (spam) or back to new. */
export async function mentionStatusAction(brand: string, ids: string[], status: "read" | "new" | "ignored" | "actioned"): Promise<ActionResult<number>> {
  return runOps(brand, () => bulkUpdate(brand, { ids: ids.slice(0, 500), op: status }), { paths: PATHS });
}

/** Override a mention's sentiment. */
export async function mentionSentimentAction(brand: string, id: string, sentiment: "positive" | "neutral" | "negative"): Promise<ActionResult<null>> {
  return runOps(brand, async () => { await updateMentionLabels(brand, id, { sentiment }); return null; }, { paths: PATHS });
}

export type ThreadMessage = Pick<MessageRow, "id" | "direction" | "author_name" | "body" | "attachments" | "created_at" | "delivery">;
/** The thread of a ticket for a card's inline expand (read access is enough). */
export async function ticketThreadAction(brand: string, ticketId: string): Promise<ActionResult<{ messages: ThreadMessage[]; subject: string }>> {
  return runOps(brand, async () => {
    const d = await getTicket(brand, ticketId);
    if (!d) throw new AppError("Ticket not found.", 404);
    return {
      subject: d.ticket.subject,
      messages: d.messages.slice(-50).map((m) => ({ id: m.id, direction: m.direction, author_name: m.author_name, body: m.body.slice(0, 4000), attachments: m.attachments, created_at: m.created_at, delivery: m.delivery })),
    };
  }, { write: false });
}

/** Ticket id for a ticket number (quick "go to ticket" box). */
export async function ticketByNumberAction(brand: string, number: number): Promise<ActionResult<string>> {
  return runOps(brand, async () => {
    const [t] = await query<{ id: string }>("SELECT id FROM cx_tickets WHERE project_id=$1 AND number=$2", [brand, Math.floor(Number(number)) || -1]);
    if (!t) throw new AppError(`Ticket #${number} not found.`, 404);
    return t.id;
  }, { write: false });
}
