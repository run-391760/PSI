import { randomUUID } from "node:crypto";
import { query, transaction } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { sentimentOf } from "@/lib/cx/ai";
import { iso } from "./store";

/** Social CRM: contact list, profile (tickets, messages, mentions, sentiment trend), notes, merge. */
export type ContactListRow = { id: string; name: string; email: string | null; phone: string | null; handles: Record<string, string>; tags: string[]; first_seen: string; last_seen: string; tickets: number; open: number; channels: string[]; sentiment: string | null };

export async function listContacts(projectId: string, f: { q?: string; tag?: string; channel?: string }) {
  const where = ["c.project_id=$1"];
  const params: unknown[] = [projectId];
  if (f.q?.trim()) { params.push(`%${f.q.trim()}%`); where.push(`(c.name ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.handles::text ILIKE $${params.length})`); }
  if (f.tag) { params.push(f.tag); where.push(`c.tags ? $${params.length}`); }
  if (f.channel) { params.push(f.channel); where.push(`EXISTS (SELECT 1 FROM cx_tickets x WHERE x.contact_id=c.id AND x.channel_kind=$${params.length})`); }
  const rows = await query<ContactListRow>(
    `SELECT c.id,c.name,c.email,c.phone,c.handles,c.tags,c.first_seen,c.last_seen,
            count(t.id)::int AS tickets, count(t.id) FILTER (WHERE t.status NOT IN ('solved','closed'))::int AS open,
            COALESCE(jsonb_agg(DISTINCT t.channel_kind) FILTER (WHERE t.id IS NOT NULL),'[]') AS channels,
            (SELECT t2.sentiment FROM cx_tickets t2 WHERE t2.contact_id=c.id ORDER BY t2.updated_at DESC LIMIT 1) AS sentiment
       FROM cx_contacts c LEFT JOIN cx_tickets t ON t.contact_id=c.id
      WHERE ${where.join(" AND ")} GROUP BY c.id ORDER BY c.last_seen DESC LIMIT 1000`,
    params,
  );
  return rows.map((r) => ({ ...r, first_seen: iso(r.first_seen)!, last_seen: iso(r.last_seen)! }));
}

export async function contactTags(projectId: string) {
  return (await query<{ tag: string }>("SELECT DISTINCT jsonb_array_elements_text(tags) AS tag FROM cx_contacts WHERE project_id=$1 ORDER BY 1", [projectId])).map((r) => r.tag);
}

export async function getContact(projectId: string, id: string) {
  const [c] = await query<{ id: string; name: string; email: string | null; phone: string | null; handles: Record<string, string>; avatar_url: string | null; tags: string[]; attributes: Record<string, string>; notes: string; first_seen: string; last_seen: string }>(
    "SELECT id,name,email,phone,handles,avatar_url,tags,attributes,notes,first_seen,last_seen FROM cx_contacts WHERE id=$1 AND project_id=$2",
    [id, projectId],
  );
  if (!c) return null;
  const tickets = (await query<{ id: string; number: number; subject: string; status: string; priority: string; channel_kind: string; sentiment: string | null; csat: number | null; created_at: string; updated_at: string }>(
    "SELECT id,number,subject,status,priority,channel_kind,sentiment,csat,created_at,updated_at FROM cx_tickets WHERE project_id=$1 AND contact_id=$2 ORDER BY updated_at DESC",
    [projectId, id],
  )).map((t) => ({ ...t, created_at: iso(t.created_at)!, updated_at: iso(t.updated_at)! }));
  const messages = (await query<{ id: string; ticket_id: string; number: number; channel_kind: string; direction: string; author_name: string; body: string; created_at: string }>(
    `SELECT m.id,m.ticket_id,t.number,t.channel_kind,m.direction,m.author_name,left(m.body,600) AS body,m.created_at FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id
      WHERE t.project_id=$1 AND t.contact_id=$2 AND m.direction<>'note' ORDER BY m.created_at DESC LIMIT 200`,
    [projectId, id],
  )).map((m) => ({ ...m, created_at: iso(m.created_at)! }));
  const handleValues = Object.values(c.handles ?? {}).filter(Boolean);
  const mentions = (await query<{ id: string; source: string; url: string | null; author: string; title: string; body: string; sentiment: string | null; published_at: string | null }>(
    `SELECT id,source,url,author,title,left(body,400) AS body,sentiment,published_at FROM cx_mentions
      WHERE project_id=$1 AND (ticket_id IN (SELECT id FROM cx_tickets WHERE contact_id=$2) OR (author_handle IS NOT NULL AND author_handle = ANY($3::text[])))
      ORDER BY published_at DESC NULLS LAST LIMIT 100`,
    [projectId, id, handleValues],
  )).map((m) => ({ ...m, published_at: iso(m.published_at) }));
  const notes = (await query<{ id: string; author_name: string; body: string; created_at: string }>("SELECT id,author_name,body,created_at FROM cx_contact_notes WHERE contact_id=$1 ORDER BY created_at DESC", [id])).map((n) => ({ ...n, created_at: iso(n.created_at)! }));
  return { contact: { ...c, first_seen: iso(c.first_seen)!, last_seen: iso(c.last_seen)! }, tickets, messages, mentions, notes, trend: sentimentTrend(messages.filter((m) => m.direction === "in")) };
}
export type ContactDetail = NonNullable<Awaited<ReturnType<typeof getContact>>>;

/** Weekly average sentiment score (-1..1) of the customer's own messages, computed from their text. */
export function sentimentTrend(msgs: { body: string; created_at: string }[]) {
  const weeks = new Map<string, { sum: number; n: number; pos: number; neg: number }>();
  for (const m of msgs) {
    const d = new Date(m.created_at);
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
    const k = monday.toISOString().slice(0, 10);
    const s = sentimentOf(m.body);
    const w = weeks.get(k) ?? { sum: 0, n: 0, pos: 0, neg: 0 };
    w.sum += s.score; w.n++;
    if (s.label === "positive") w.pos++;
    if (s.label === "negative") w.neg++;
    weeks.set(k, w);
  }
  return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, w]) => ({ week, score: Math.round((w.sum / w.n) * 100) / 100, messages: w.n, positive: w.pos, negative: w.neg }));
}

export async function updateContact(projectId: string, id: string, p: { name?: string; email?: string | null; phone?: string | null; tags?: string[]; attributes?: Record<string, string>; notes?: string }) {
  const email = p.email === undefined ? undefined : p.email?.trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("Enter a valid email address.");
  if (email) {
    const [dupe] = await query<{ id: string }>("SELECT id FROM cx_contacts WHERE project_id=$1 AND lower(email)=$2 AND id<>$3", [projectId, email, id]);
    if (dupe) throw new AppError("Another contact already has this email — merge them instead.");
  }
  const attrs = p.attributes ? Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k.trim().slice(0, 60), String(v).slice(0, 500)]).filter(([k]) => k)) : undefined;
  await query(
    `UPDATE cx_contacts SET name=COALESCE($3,name), email=CASE WHEN $4 THEN $5 ELSE email END, phone=CASE WHEN $6 THEN $7 ELSE phone END,
            tags=COALESCE($8::jsonb,tags), attributes=COALESCE($9::jsonb,attributes), notes=COALESCE($10,notes) WHERE id=$1 AND project_id=$2`,
    [id, projectId, p.name?.trim() || null, email !== undefined, email ?? null, p.phone !== undefined, p.phone?.trim() || null,
      p.tags ? JSON.stringify([...new Set(p.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))]) : null, attrs ? JSON.stringify(attrs) : null, p.notes ?? null],
  );
}

export async function addContactNote(projectId: string, id: string, user: { id: string; name: string }, body: string) {
  if (!body.trim()) throw new AppError("Write a note first.");
  const [c] = await query("SELECT 1 FROM cx_contacts WHERE id=$1 AND project_id=$2", [id, projectId]);
  if (!c) throw new AppError("Contact not found.", 404);
  await query("INSERT INTO cx_contact_notes(id,contact_id,author_user_id,author_name,body) VALUES($1,$2,$3,$4,$5)", [randomUUID(), id, user.id, user.name, body.trim().slice(0, 5000)]);
}
export async function deleteContactNote(projectId: string, noteId: string) {
  await query("DELETE FROM cx_contact_notes n USING cx_contacts c WHERE n.id=$1 AND c.id=n.contact_id AND c.project_id=$2", [noteId, projectId]);
}

/** Candidate duplicates: same normalized name, same phone digits, or same email local part. */
export async function duplicateCandidates(projectId: string, id: string) {
  const [c] = await query<{ name: string; email: string | null; phone: string | null }>("SELECT name,email,phone FROM cx_contacts WHERE id=$1 AND project_id=$2", [id, projectId]);
  if (!c) return [];
  const digits = (c.phone ?? "").replace(/\D/g, "").slice(-9);
  const local = c.email?.split("@")[0] ?? "";
  return query<{ id: string; name: string; email: string | null; phone: string | null; reason: string }>(
    `SELECT id,name,email,phone, CASE WHEN $3<>'' AND right(regexp_replace(coalesce(phone,''),'\\D','','g'),9)=$3 THEN 'Same phone'
                                      WHEN lower(trim(name))=lower(trim($4)) AND $4<>'' THEN 'Same name'
                                      ELSE 'Similar email' END AS reason
       FROM cx_contacts WHERE project_id=$1 AND id<>$2 AND (
         ($3<>'' AND right(regexp_replace(coalesce(phone,''),'\\D','','g'),9)=$3)
         OR (lower(trim(name))=lower(trim($4)) AND length(trim($4))>2 AND lower($4)<>'visitor')
         OR ($5<>'' AND length($5)>3 AND split_part(lower(coalesce(email,'')),'@',1)=lower($5)))
      LIMIT 10`,
    [projectId, id, digits, c.name ?? "", local],
  );
}

/** Merge `sourceIds` into `targetId`: tickets and notes move; missing fields, handles, tags, attributes are combined. */
export async function mergeContacts(projectId: string, targetId: string, sourceIds: string[]) {
  const sources = sourceIds.filter((s) => s !== targetId);
  if (!sources.length) throw new AppError("Choose contacts to merge.");
  return transaction(async (q) => {
    const [t] = await q<{ id: string }>("SELECT id FROM cx_contacts WHERE id=$1 AND project_id=$2", [targetId, projectId]);
    if (!t) throw new AppError("Contact not found.", 404);
    const src = await q<{ id: string; email: string | null; phone: string | null; handles: object; tags: string[]; attributes: object; notes: string; first_seen: string; name: string }>(
      "SELECT id,email,phone,handles,tags,attributes,notes,first_seen,name FROM cx_contacts WHERE project_id=$1 AND id = ANY($2)",
      [projectId, sources],
    );
    for (const s of src) {
      await q("UPDATE cx_tickets SET contact_id=$1 WHERE contact_id=$2", [targetId, s.id]);
      await q("UPDATE cx_contact_notes SET contact_id=$1 WHERE contact_id=$2", [targetId, s.id]);
      await q("UPDATE cx_inbox_chat_sessions SET contact_id=$1 WHERE contact_id=$2", [targetId, s.id]);
      await q("DELETE FROM cx_contacts WHERE id=$1", [s.id]);
      await q(
        `UPDATE cx_contacts SET email=COALESCE(email,$2), phone=COALESCE(phone,$3), handles=$4::jsonb || handles, attributes=$5::jsonb || attributes,
                tags=(SELECT COALESCE(jsonb_agg(DISTINCT v),'[]') FROM jsonb_array_elements(tags || $6::jsonb) v),
                notes=CASE WHEN $7='' THEN notes WHEN notes='' THEN $7 ELSE notes || E'\\n\\n' || $7 END,
                first_seen=LEAST(first_seen,$8), name=CASE WHEN name='' OR lower(name)='visitor' THEN $9 ELSE name END WHERE id=$1`,
        [targetId, s.email, s.phone, JSON.stringify(s.handles ?? {}), JSON.stringify(s.attributes ?? {}), JSON.stringify(s.tags ?? []), s.notes ?? "", s.first_seen, s.name],
      );
    }
    return src.length;
  });
}

export async function deleteContact(projectId: string, id: string) {
  await query("DELETE FROM cx_contacts WHERE id=$1 AND project_id=$2", [id, projectId]);
}
