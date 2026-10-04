import { query } from "@/lib/db";
import { parseSearch } from "@/lib/cx/inbox/model";
import { listTickets, type TicketListRow } from "@/lib/cx/inbox/store";
import { getFieldDefs } from "@/lib/cx/admin/fields";
import { searchScopes } from "./model";

/**
 * Quick Search: one query across tickets (full inbox field:value syntax), messages, contacts, listening
 * mentions and tasks. Free text matches every entity; field terms apply where they make sense
 * (name/email/phone → contacts, sentiment/topic/lang → mentions, status/priority/assignee/ticket → tasks).
 */
export type SearchResults = {
  tickets: TicketListRow[];
  messages: { id: string; ticket_id: string; number: number; subject: string; direction: string; author_name: string; body: string; created_at: string; channel_kind: string }[];
  contacts: { id: string; name: string; email: string | null; phone: string | null; tickets: number; last_seen: string }[];
  mentions: { id: string; source: string; title: string; body: string; author: string; url: string | null; sentiment: string | null; published_at: string | null; ticket_id: string | null }[];
  tasks: { id: string; number: number; title: string; status: string; priority: string; due_at: string | null; assignee_name: string | null; ticket_id: string | null }[];
};
const LIMIT = 25;
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

export async function quickSearch(projectId: string, userId: string, q: string, only?: keyof SearchResults): Promise<SearchResults> {
  const empty: SearchResults = { tickets: [], messages: [], contacts: [], mentions: [], tasks: [] };
  if (!q.trim()) return empty;
  const defs = await getFieldDefs(projectId).catch(() => []);
  const parsed = parseSearch(q, defs.filter((d) => d.scope === "ticket").map((d) => d.key));
  const scopes = searchScopes(parsed.terms);
  const text = parsed.text.replace(/^#/, "");
  const like = `%${text}%`;
  const want = (k: keyof SearchResults) => !only || only === k;
  const lim = only ? 200 : LIMIT;
  const hasOtherTerms = (allowed: string[]) => parsed.terms.some((t) => !allowed.includes(t.field));

  const [tickets, messages, contacts, mentions, tasks] = await Promise.all([
    want("tickets") ? listTickets(projectId, userId, { view: "all", q, sort: "updated" }, lim, { fieldKeys: defs.map((d) => d.key) }) : [],
    want("messages") && text && !hasOtherTerms(["channel"])
      ? query<SearchResults["messages"][number]>(
          `SELECT m.id,m.ticket_id,t.number,t.subject,m.direction,m.author_name,m.body,m.created_at,t.channel_kind FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id
            WHERE t.project_id=$1 AND m.body ILIKE $2 AND ($3::text IS NULL OR t.channel_kind=$3) ORDER BY m.created_at DESC LIMIT $4`,
          [projectId, like, parsed.terms.find((t) => t.field === "channel" && !t.neg)?.value ?? null, lim],
        )
      : [],
    want("contacts") && (text || scopes.contacts.length) && !hasOtherTerms(["name", "email", "phone"])
      ? (() => {
          const params: unknown[] = [projectId];
          const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
          const where = ["c.project_id=$1"];
          if (text) { const x = p(like); where.push(`(c.name ILIKE ${x} OR c.email ILIKE ${x} OR c.phone ILIKE ${x} OR c.handles::text ILIKE ${x} OR c.notes ILIKE ${x})`); }
          for (const t of scopes.contacts) {
            const cond = t.field === "phone" ? `regexp_replace(COALESCE(c.phone,''),'\\D','','g') LIKE ${p(`%${t.value.replace(/\D/g, "")}%`)}` : `c.${t.field} ILIKE ${p(`%${t.value}%`)}`;
            where.push(t.neg ? `NOT COALESCE(${cond}, false)` : cond);
          }
          return query<SearchResults["contacts"][number]>(
            `SELECT c.id,c.name,c.email,c.phone,c.last_seen,(SELECT count(*)::int FROM cx_tickets t WHERE t.contact_id=c.id) AS tickets FROM cx_contacts c WHERE ${where.join(" AND ")} ORDER BY c.last_seen DESC LIMIT ${p(lim)}`,
            params,
          );
        })()
      : [],
    want("mentions") && (text || scopes.mentions.length) && !hasOtherTerms(["sentiment", "topic", "lang"])
      ? (() => {
          const params: unknown[] = [projectId];
          const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
          const where = ["mn.project_id=$1"];
          if (text) { const x = p(like); where.push(`(mn.title ILIKE ${x} OR mn.body ILIKE ${x} OR mn.author ILIKE ${x} OR mn.author_handle ILIKE ${x} OR mn.url ILIKE ${x})`); }
          for (const t of scopes.mentions) {
            const cond = t.field === "sentiment" ? `mn.sentiment=${p(t.value.toLowerCase())}` : t.field === "lang" ? `mn.language=${p(t.value.toLowerCase())}` : `EXISTS (SELECT 1 FROM cx_topics tp WHERE tp.id=mn.topic_id AND tp.name ILIKE ${p(`%${t.value}%`)})`;
            where.push(t.neg ? `NOT COALESCE(${cond}, false)` : cond);
          }
          return query<SearchResults["mentions"][number]>(
            `SELECT mn.id,mn.source,mn.title,mn.body,mn.author,mn.url,mn.sentiment,mn.published_at,mn.ticket_id FROM cx_mentions mn WHERE ${where.join(" AND ")} ORDER BY mn.published_at DESC NULLS LAST LIMIT ${p(lim)}`,
            params,
          );
        })()
      : [],
    want("tasks") && (text || scopes.tasks.length) && !hasOtherTerms(["status", "priority", "assignee", "ticket"])
      ? (() => {
          const params: unknown[] = [projectId, userId];
          const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
          const where = ["k.project_id=$1", "$2::text IS NOT NULL"];
          if (text) { const x = p(like); where.push(`(k.title ILIKE ${x} OR k.description ILIKE ${x} OR k.classification_path ILIKE ${x} OR ('T-' || k.number) ILIKE ${x})`); }
          for (const t of scopes.tasks) {
            const v = t.value.toLowerCase();
            const cond = t.field === "status" ? `k.status=${p(v.replace(/[- ]/g, "_"))}` : t.field === "priority" ? `k.priority=${p(v)}`
              : t.field === "ticket" ? `tk.number=${p(Number(v.replace(/^#/, "")) || -1)}`
              : v === "me" ? "k.assignee_id=$2" : v === "none" ? "k.assignee_id IS NULL" : `(u.name ILIKE ${p(`%${t.value}%`)})`;
            where.push(t.neg ? `NOT COALESCE(${cond}, false)` : cond);
          }
          return query<SearchResults["tasks"][number]>(
            `SELECT k.id,k.number,k.title,k.status,k.priority,k.due_at,COALESCE(NULLIF(u.name,''),u.email) AS assignee_name,k.ticket_id FROM cx_ops_tasks k LEFT JOIN users u ON u.id=k.assignee_id LEFT JOIN cx_tickets tk ON tk.id=k.ticket_id
              WHERE ${where.join(" AND ")} ORDER BY k.updated_at DESC LIMIT ${p(lim)}`,
            params,
          );
        })()
      : [],
  ]);
  return {
    tickets,
    messages: messages.map((m) => ({ ...m, created_at: iso(m.created_at)! })),
    contacts: contacts.map((c) => ({ ...c, last_seen: iso(c.last_seen)! })),
    mentions: mentions.map((m) => ({ ...m, published_at: iso(m.published_at) })),
    tasks: tasks.map((t) => ({ ...t, due_at: iso(t.due_at) })),
  };
}
