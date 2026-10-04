import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";

/** Per-user bookmarks of tickets and single messages (server only; callers verified brand access). */
export type Bookmark = {
  id: string; ticket_id: string; message_id: string | null; note: string; created_at: string;
  number: number; subject: string; status: string; channel_kind: string; channel_name: string | null; contact_name: string | null;
  message_body: string | null; message_direction: string | null; message_author: string | null; message_at: string | null;
};

export async function toggleBookmark(projectId: string, userId: string, input: { ticketId: string; messageId?: string | null; note?: string }) {
  const [t] = await query<{ id: string }>("SELECT id FROM cx_tickets WHERE id=$1 AND project_id=$2", [input.ticketId, projectId]);
  if (!t) throw new AppError("Ticket not found.", 404);
  if (input.messageId) {
    const [m] = await query("SELECT 1 FROM cx_messages WHERE id=$1 AND ticket_id=$2", [input.messageId, input.ticketId]);
    if (!m) throw new AppError("Message not found.", 404);
  }
  const [ex] = await query<{ id: string }>("SELECT id FROM cx_ops_bookmarks WHERE user_id=$1 AND ticket_id=$2 AND COALESCE(message_id,'')=$3", [userId, input.ticketId, input.messageId ?? ""]);
  if (ex) {
    await query("DELETE FROM cx_ops_bookmarks WHERE id=$1", [ex.id]);
    return { bookmarked: false };
  }
  await query("INSERT INTO cx_ops_bookmarks(id,project_id,user_id,ticket_id,message_id,note) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), projectId, userId, input.ticketId, input.messageId ?? null, (input.note ?? "").slice(0, 500)]);
  return { bookmarked: true };
}

export async function updateBookmarkNote(projectId: string, userId: string, id: string, note: string) {
  const r = await query("UPDATE cx_ops_bookmarks SET note=$4 WHERE id=$1 AND project_id=$2 AND user_id=$3 RETURNING id", [id, projectId, userId, note.slice(0, 500)]);
  if (!r.length) throw new AppError("Bookmark not found.", 404);
}
export async function deleteBookmark(projectId: string, userId: string, id: string) {
  await query("DELETE FROM cx_ops_bookmarks WHERE id=$1 AND project_id=$2 AND user_id=$3", [id, projectId, userId]);
}

export async function listBookmarks(projectId: string, userId: string, opts: { kind?: "ticket" | "message"; q?: string } = {}): Promise<Bookmark[]> {
  const rows = await query<Bookmark>(
    `SELECT b.id,b.ticket_id,b.message_id,b.note,b.created_at,t.number,t.subject,t.status,t.channel_kind,ch.name AS channel_name,c.name AS contact_name,
            m.body AS message_body,m.direction AS message_direction,m.author_name AS message_author,m.created_at AS message_at
       FROM cx_ops_bookmarks b JOIN cx_tickets t ON t.id=b.ticket_id LEFT JOIN cx_messages m ON m.id=b.message_id
       LEFT JOIN cx_channels ch ON ch.id=t.channel_id LEFT JOIN cx_contacts c ON c.id=t.contact_id
      WHERE b.project_id=$1 AND b.user_id=$2
        AND ($3::text IS NULL OR ($3='ticket' AND b.message_id IS NULL) OR ($3='message' AND b.message_id IS NOT NULL))
        AND ($4::text IS NULL OR t.subject ILIKE $4 OR m.body ILIKE $4 OR b.note ILIKE $4 OR c.name ILIKE $4)
      ORDER BY b.created_at DESC LIMIT 1000`,
    [projectId, userId, opts.kind ?? null, opts.q ? `%${opts.q}%` : null],
  );
  return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString(), message_at: r.message_at ? new Date(r.message_at).toISOString() : null }));
}

/** Message ids the user bookmarked inside one ticket, and whether the ticket itself is bookmarked. */
export async function ticketBookmarks(userId: string, ticketId: string) {
  const rows = await query<{ message_id: string | null }>("SELECT message_id FROM cx_ops_bookmarks WHERE user_id=$1 AND ticket_id=$2", [userId, ticketId]);
  return { ticket: rows.some((r) => r.message_id == null), messages: rows.map((r) => r.message_id).filter((x): x is string => !!x) };
}
