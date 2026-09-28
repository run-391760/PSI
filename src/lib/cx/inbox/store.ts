import { randomUUID } from "node:crypto";
import { query, transaction, type Query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { analyzeText } from "@/lib/cx/ai";
import { evaluateRules, type Rule } from "./rules";
import { agentsOf, listTeams as insightsTeams } from "@/lib/cx/insights/team";
import { slaDueDates, slaTargetMap } from "@/lib/cx/insights/sla";
import { withDefaults } from "./sla";

/**
 * Tickets, messages and contacts of the CX inbox (server only). All functions take a projectId the
 * caller has already verified (getProject) and scope every statement to it.
 */
export const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
export const STATUSES = ["new", "open", "pending", "on_hold", "solved", "closed"] as const;
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];

export type TicketListRow = {
  id: string; number: number; subject: string; status: Status; priority: Priority; channel_kind: string; channel_name: string | null;
  contact_id: string | null; contact_name: string | null; contact_email: string | null; assignee_id: string | null; assignee_name: string | null;
  team: string | null; tags: string[]; sentiment: string | null; intent: string | null; language: string | null;
  first_response_due: string | null; resolution_due: string | null; first_response_at: string | null; resolved_at: string | null;
  csat: number | null; created_at: string; updated_at: string; last_body: string | null; last_direction: string | null; last_at: string | null; messages: number;
};
export type MessageRow = { id: string; direction: "in" | "out" | "note"; author_name: string; author_user_id: string | null; body: string; html: string | null; attachments: { name?: string; type?: string; size?: number; url?: string }[]; delivery: string; delivery_error: string | null; created_at: string };

const DONE = "('solved','closed')";
export type View = "mine" | "unassigned" | "all" | "open" | "pending" | "solved" | "breached";
export const VIEWS: { id: View; label: string }[] = [
  { id: "mine", label: "My tickets" },
  { id: "unassigned", label: "Unassigned" },
  { id: "open", label: "All open" },
  { id: "pending", label: "Pending" },
  { id: "breached", label: "SLA breached" },
  { id: "solved", label: "Solved" },
  { id: "all", label: "All tickets" },
];
const BREACHED = `(t.status NOT IN ${DONE} AND ((t.first_response_at IS NULL AND t.first_response_due < now()) OR (t.resolution_due < now())))`;
function viewSql(view: View, userParam: string) {
  switch (view) {
    case "mine": return `t.assignee_id=${userParam}::text AND t.status NOT IN ${DONE}`;
    case "unassigned": return `t.assignee_id IS NULL AND t.status NOT IN ${DONE}`;
    case "open": return `t.status NOT IN ${DONE}`;
    case "pending": return `t.status IN ('pending','on_hold')`;
    case "solved": return `t.status IN ${DONE}`;
    case "breached": return BREACHED;
    default: return "true";
  }
}

export type TicketFilters = { view?: View; q?: string; channel?: string; priority?: string; status?: string; tag?: string; team?: string; assignee?: string; sentiment?: string };

export async function listTickets(projectId: string, userId: string, f: TicketFilters, limit = 300) {
  const where = [`t.project_id=$1`, `$2::text IS NOT NULL`, viewSql(f.view ?? "open", "$2")];
  const params: unknown[] = [projectId, userId];
  const add = (sql: (p: string) => string, v: unknown) => { params.push(v); where.push(sql(`$${params.length}`)); };
  if (f.channel) add((p) => `t.channel_kind=${p}`, f.channel);
  if (f.priority) add((p) => `t.priority=${p}`, f.priority);
  if (f.status) add((p) => `t.status=${p}`, f.status);
  if (f.team) add((p) => `t.team=${p}`, f.team);
  if (f.sentiment) add((p) => `t.sentiment=${p}`, f.sentiment);
  if (f.assignee) add((p) => `t.assignee_id=${p}`, f.assignee);
  if (f.tag) add((p) => `t.tags ? ${p}`, f.tag);
  if (f.q?.trim()) {
    const q = f.q.trim().replace(/^#/, "");
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    params.push(/^\d{1,9}$/.test(q) ? Number(q) : -1);
    where.push(`(t.subject ILIKE ${p} OR c.name ILIKE ${p} OR c.email ILIKE ${p} OR t.number=$${params.length} OR EXISTS (SELECT 1 FROM cx_messages mm WHERE mm.ticket_id=t.id AND mm.body ILIKE ${p}))`);
  }
  params.push(limit);
  const rows = await query<TicketListRow>(
    `SELECT t.id,t.number,t.subject,t.status,t.priority,t.channel_kind,ch.name AS channel_name,t.contact_id,c.name AS contact_name,c.email AS contact_email,
            t.assignee_id,u.name AS assignee_name,t.team,t.tags,t.sentiment,t.intent,t.language,t.first_response_due,t.resolution_due,t.first_response_at,t.resolved_at,
            t.csat,t.created_at,t.updated_at,lm.body AS last_body,lm.direction AS last_direction,lm.created_at AS last_at,
            (SELECT count(*)::int FROM cx_messages x WHERE x.ticket_id=t.id AND x.direction<>'note') AS messages
       FROM cx_tickets t
       LEFT JOIN cx_contacts c ON c.id=t.contact_id
       LEFT JOIN cx_channels ch ON ch.id=t.channel_id
       LEFT JOIN users u ON u.id=t.assignee_id
       LEFT JOIN LATERAL (SELECT body,direction,created_at FROM cx_messages m WHERE m.ticket_id=t.id AND m.direction<>'note' ORDER BY created_at DESC LIMIT 1) lm ON true
      WHERE ${where.join(" AND ")}
      ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, t.updated_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows.map(normTicket);
}
function normTicket<T extends Record<string, unknown>>(r: T) {
  const o: Record<string, unknown> = { ...r };
  for (const k of ["first_response_due", "resolution_due", "first_response_at", "resolved_at", "created_at", "updated_at", "last_at"]) if (k in o) o[k] = iso(o[k]);
  return o as T;
}

export async function viewCounts(projectId: string, userId: string) {
  const [r] = await query<Record<View, number>>(
    `SELECT ${VIEWS.map((v) => `count(*) FILTER (WHERE ${viewSql(v.id, "$2")})::int AS ${v.id}`).join(",")} FROM cx_tickets t WHERE t.project_id=$1`,
    [projectId, userId],
  );
  return r;
}

export async function inboxStats(projectId: string) {
  const [r] = await query<{ open: number; unassigned: number; breached: number; created_7d: number; solved_7d: number; frt_min: number | null; csat: number | null; csat_n: number }>(
    `SELECT count(*) FILTER (WHERE t.status NOT IN ${DONE})::int AS open,
            count(*) FILTER (WHERE t.status NOT IN ${DONE} AND t.assignee_id IS NULL)::int AS unassigned,
            count(*) FILTER (WHERE ${BREACHED})::int AS breached,
            count(*) FILTER (WHERE t.created_at > now()-interval '7 days')::int AS created_7d,
            count(*) FILTER (WHERE t.resolved_at > now()-interval '7 days')::int AS solved_7d,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM t.first_response_at - t.created_at)/60) FILTER (WHERE t.first_response_at > now()-interval '30 days'))::float AS frt_min,
            avg(t.csat) FILTER (WHERE t.csat IS NOT NULL)::float AS csat, count(t.csat)::int AS csat_n
       FROM cx_tickets t WHERE t.project_id=$1`,
    [projectId],
  );
  return r;
}

export async function projectOwner(projectId: string) {
  const [p] = await query<{ owner_id: string; name: string; domain: string }>("SELECT owner_id,name,domain FROM projects WHERE id=$1", [projectId]);
  if (!p) throw new AppError("Brand not found.", 404);
  return p;
}

// ---------------------------------------------------------------- agents, teams, SLA policies

/** Due dates for a ticket: Team & SLAs policy of the priority (business hours/holidays applied there), else 1h/24h. */
export async function ticketDue(projectId: string, priority: string, from: Date | string) {
  const f = new Date(from);
  try {
    return withDefaults(await slaDueDates(projectId, priority, f), f);
  } catch {
    return withDefaults({ firstResponseMinutes: null, resolutionMinutes: null, firstResponseDue: null, resolutionDue: null }, f);
  }
}
/** Number of priorities with an SLA policy (for the page header). */
export async function slaPolicyCount(projectId: string) {
  try {
    return Object.values(await slaTargetMap(projectId)).filter((t) => t.firstResponse != null || t.resolution != null).length;
  } catch {
    return 0;
  }
}

export type Agent = { id: string; name: string; email: string };
/** Assignable agents: brand owner + Team & SLAs members except viewers. */
export async function listAgents(projectId: string): Promise<Agent[]> {
  try {
    const a = await agentsOf(projectId);
    if (a.length) return a.map((x) => ({ id: x.id, name: x.name, email: x.email }));
  } catch {}
  const owner = await query<Agent>("SELECT u.id,u.name,u.email FROM projects p JOIN users u ON u.id=p.owner_id WHERE p.id=$1", [projectId]);
  return owner.map((a) => ({ ...a, name: a.name || a.email }));
}
export async function listTeams(projectId: string): Promise<string[]> {
  const names = new Set<string>();
  try {
    for (const t of await insightsTeams(projectId)) names.add(t.name);
  } catch {}
  for (const r of await query<{ team: string }>("SELECT DISTINCT team FROM cx_tickets WHERE project_id=$1 AND team IS NOT NULL AND team<>''", [projectId])) names.add(r.team);
  for (const r of await query<{ team: string }>("SELECT DISTINCT actions->>'team' AS team FROM cx_inbox_rules WHERE project_id=$1 AND coalesce(actions->>'team','')<>''", [projectId])) names.add(r.team);
  return [...names].sort((a, b) => a.localeCompare(b));
}
export async function listTags(projectId: string): Promise<string[]> {
  const rows = await query<{ tag: string }>("SELECT DISTINCT jsonb_array_elements_text(tags) AS tag FROM cx_tickets WHERE project_id=$1 ORDER BY 1 LIMIT 300", [projectId]);
  return rows.map((r) => r.tag);
}

// ---------------------------------------------------------------- contacts

export type ContactInput = { name?: string | null; email?: string | null; phone?: string | null; handle?: { kind: string; id: string } | null; attributes?: Record<string, string> };
export async function upsertContact(q: Query, projectId: string, c: ContactInput) {
  const email = c.email?.trim().toLowerCase() || null;
  const phone = c.phone?.replace(/[^\d+]/g, "") || null;
  let found: { id: string } | undefined;
  if (email) [found] = await q<{ id: string }>("SELECT id FROM cx_contacts WHERE project_id=$1 AND lower(email)=$2", [projectId, email]);
  if (!found && c.handle?.id) [found] = await q<{ id: string }>("SELECT id FROM cx_contacts WHERE project_id=$1 AND handles->>$2=$3", [projectId, c.handle.kind, c.handle.id]);
  if (!found && phone) [found] = await q<{ id: string }>("SELECT id FROM cx_contacts WHERE project_id=$1 AND phone=$2", [projectId, phone]);
  const handles = c.handle?.id ? JSON.stringify({ [c.handle.kind]: c.handle.id }) : "{}";
  const attrs = JSON.stringify(c.attributes ?? {});
  if (found) {
    await q(
      `UPDATE cx_contacts SET last_seen=now(), name=CASE WHEN name='' THEN $2 ELSE name END, email=COALESCE(email,$3), phone=COALESCE(phone,$4),
              handles=handles || $5::jsonb, attributes=$6::jsonb || attributes WHERE id=$1`,
      [found.id, c.name?.trim() ?? "", email, phone, handles, attrs],
    );
    return found.id;
  }
  const id = randomUUID();
  await q(
    "INSERT INTO cx_contacts(id,project_id,name,email,phone,handles,attributes) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)",
    [id, projectId, c.name?.trim() || email?.split("@")[0] || phone || "Visitor", email, phone, handles, attrs],
  );
  return id;
}

// ---------------------------------------------------------------- ticket creation / inbound

export type InboundInput = {
  projectId: string;
  channelKind: string;
  channelId?: string | null;
  contact: ContactInput;
  subject: string;
  body: string;
  html?: string | null;
  attachments?: MessageRow["attachments"];
  externalId?: string | null;
  externalThreadId?: string | null;
  authorName?: string;
  createdAt?: string | null;
};

async function loadRules(q: Query, projectId: string) {
  const rows = await q<Rule & { actions: Rule["actions"] }>("SELECT id,kind,name,position,active,match,conditions,actions FROM cx_inbox_rules WHERE project_id=$1 AND active", [projectId]);
  return rows;
}

/** Create a ticket with its first inbound message; applies routing/tag rules and SLA due dates. */
export async function createTicket(input: InboundInput) {
  const text = `${input.subject}\n${input.body}`;
  const a = analyzeText(text);
  // Rules and SLA are resolved before the transaction (PGlite runs one connection; no queries outside `q` inside it).
  const rules = await loadRules(query, input.projectId);
  const { actions, matched } = evaluateRules(rules, { channel: input.channelKind, subject: input.subject, body: input.body, intent: a.intent, sentiment: a.sentiment, language: a.language, email: input.contact.email ?? null });
  const priority = actions.priority ?? (a.intent === "cancellation" && a.sentiment === "negative" ? "high" : "normal");
  const createdAt = input.createdAt && new Date(input.createdAt) < new Date() ? new Date(input.createdAt) : new Date();
  const due = await ticketDue(input.projectId, priority, createdAt);
  const result = await transaction(async (q) => {
    const contactId = await upsertContact(q, input.projectId, input.contact);
    let assignee = actions.assignee;
    if (assignee) {
      const [ok] = await q("SELECT 1 FROM users WHERE id=$1", [assignee]);
      if (!ok) assignee = null;
    }
    const [{ n }] = await q<{ n: number }>("SELECT COALESCE(MAX(number),0)+1 AS n FROM cx_tickets WHERE project_id=$1", [input.projectId]);
    const id = randomUUID();
    await q(
      `INSERT INTO cx_tickets(id,project_id,number,subject,status,priority,channel_kind,channel_id,contact_id,assignee_id,team,tags,sentiment,intent,language,external_thread_id,first_response_due,resolution_due,created_at,updated_at)
       VALUES($1,$2,$3,$4,'new',$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$18)`,
      [id, input.projectId, n, input.subject.slice(0, 300) || "(no subject)", priority, input.channelKind, input.channelId ?? null, contactId, assignee, actions.team, JSON.stringify(actions.tags), a.sentiment, a.intent, a.language, input.externalThreadId ?? null, due.firstResponseDue, due.resolutionDue, createdAt],
    );
    await insertMessage(q, id, { direction: "in", authorName: input.authorName ?? input.contact.name ?? "", body: input.body, html: input.html, attachments: input.attachments, externalId: input.externalId, createdAt: input.createdAt });
    if (matched.length) {
      await q("UPDATE cx_inbox_rules SET hits=hits+1, last_hit_at=now() WHERE id = ANY($1)", [matched]);
      const names = rules.filter((r) => matched.includes(r.id)).map((r) => r.name).join(", ");
      await logEvent(q, id, "Automation", "rules", `Applied: ${names}`);
    }
    return { id, number: n, contactId, due };
  });
  await scheduleSlaChecks(input.projectId, result.id, ...[result.due.firstResponseDue, result.due.resolutionDue].filter((d): d is string => !!d)).catch(() => {});
  return result;
}

/** Append an inbound message to a ticket (reopening it when it was pending/solved). */
export async function addInbound(projectId: string, ticketId: string, m: { body: string; html?: string | null; authorName: string; attachments?: MessageRow["attachments"]; externalId?: string | null; createdAt?: string | null }) {
  await transaction(async (q) => {
    const [t] = await q<{ id: string }>("SELECT id FROM cx_tickets WHERE id=$1 AND project_id=$2", [ticketId, projectId]);
    if (!t) throw new AppError("Ticket not found.", 404);
    await insertMessage(q, ticketId, { direction: "in", ...m });
    await q(`UPDATE cx_tickets SET updated_at=now(), status=CASE WHEN status IN ('pending','solved','on_hold') THEN 'open' ELSE status END, resolved_at=CASE WHEN status='solved' THEN NULL ELSE resolved_at END WHERE id=$1`, [ticketId]);
    await q("UPDATE cx_contacts SET last_seen=now() WHERE id=(SELECT contact_id FROM cx_tickets WHERE id=$1)", [ticketId]);
  });
}

export async function insertMessage(
  q: Query,
  ticketId: string,
  m: { direction: "in" | "out" | "note"; authorName: string; authorUserId?: string | null; body: string; html?: string | null; attachments?: MessageRow["attachments"]; externalId?: string | null; delivery?: string; deliveryError?: string | null; createdAt?: string | null },
) {
  const id = randomUUID();
  await q(
    `INSERT INTO cx_messages(id,ticket_id,direction,author_user_id,author_name,body,html,attachments,external_id,delivery,delivery_error,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,COALESCE($12::timestamptz,now()))`,
    [id, ticketId, m.direction, m.authorUserId ?? null, m.authorName, m.body, m.html ?? null, JSON.stringify(m.attachments ?? []), m.externalId ?? null, m.delivery ?? (m.direction === "in" ? "stored" : "stored"), m.deliveryError ?? null, m.createdAt ?? null],
  );
  return id;
}

export async function logEvent(q: Query, ticketId: string, actor: string, kind: string, detail: string) {
  await q("INSERT INTO cx_inbox_events(id,ticket_id,actor,kind,detail) VALUES($1,$2,$3,$4,$5)", [randomUUID(), ticketId, actor, kind, detail]);
}

async function scheduleSlaChecks(projectId: string, ticketId: string, ...dues: string[]) {
  const { enqueue } = await import("@/lib/jobs/queue");
  const { owner_id } = await projectOwner(projectId);
  for (const [i, d] of dues.entries())
    await enqueue({ kind: "cx.inbox.sla-check", ownerId: owner_id, projectId, payload: { ticketId }, dedupeKey: `cx.inbox.sla-check:${ticketId}:${i}:${d}`, runAfter: new Date(new Date(d).getTime() + 5_000) });
}

// ---------------------------------------------------------------- ticket detail & updates

export async function getTicket(projectId: string, id: string) {
  const [t] = await query<TicketListRow & { channel_id: string | null; external_thread_id: string | null; contact_phone: string | null; contact_handles: Record<string, string>; contact_tags: string[] }>(
    `SELECT t.*,ch.name AS channel_name,c.name AS contact_name,c.email AS contact_email,c.phone AS contact_phone,c.handles AS contact_handles,c.tags AS contact_tags,u.name AS assignee_name
       FROM cx_tickets t LEFT JOIN cx_contacts c ON c.id=t.contact_id LEFT JOIN cx_channels ch ON ch.id=t.channel_id LEFT JOIN users u ON u.id=t.assignee_id
      WHERE t.project_id=$1 AND t.id=$2`,
    [projectId, id],
  );
  if (!t) return null;
  const messages = (await query<MessageRow>("SELECT id,direction,author_name,author_user_id,body,html,attachments,delivery,delivery_error,created_at FROM cx_messages WHERE ticket_id=$1 ORDER BY created_at, id", [id])).map((m) => ({ ...m, created_at: iso(m.created_at)! }));
  const events = (await query<{ id: string; actor: string; kind: string; detail: string; created_at: string }>("SELECT id,actor,kind,detail,created_at FROM cx_inbox_events WHERE ticket_id=$1 ORDER BY created_at", [id])).map((e) => ({ ...e, created_at: iso(e.created_at)! }));
  const related = t.contact_id
    ? (await query<{ id: string; number: number; subject: string; status: string; channel_kind: string; created_at: string }>("SELECT id,number,subject,status,channel_kind,created_at FROM cx_tickets WHERE project_id=$1 AND contact_id=$2 AND id<>$3 ORDER BY created_at DESC LIMIT 8", [projectId, t.contact_id, id])).map((r) => ({ ...r, created_at: iso(r.created_at)! }))
    : [];
  const mentions = (await query<{ id: string; source: string; url: string | null; title: string; author: string; published_at: string | null }>("SELECT id,source,url,title,author,published_at FROM cx_mentions WHERE ticket_id=$1 AND project_id=$2 ORDER BY published_at DESC NULLS LAST LIMIT 10", [id, projectId])).map((m) => ({ ...m, published_at: iso(m.published_at) }));
  const [chat] = await query<{ visitor_seen_at: string; visitor_typing_at: string | null; page_url: string | null }>("SELECT visitor_seen_at,visitor_typing_at,page_url FROM cx_inbox_chat_sessions WHERE ticket_id=$1 ORDER BY visitor_seen_at DESC LIMIT 1", [id]);
  return { ticket: normTicket(t), messages, events, related, mentions, chat: chat ? { seenAt: iso(chat.visitor_seen_at)!, typingAt: iso(chat.visitor_typing_at), pageUrl: chat.page_url } : null };
}
export type TicketDetail = NonNullable<Awaited<ReturnType<typeof getTicket>>>;

export type TicketPatch = { status?: Status; priority?: Priority; assignee_id?: string | null; team?: string | null; tags?: string[]; addTags?: string[]; removeTags?: string[]; subject?: string; csat?: number | null };

export async function updateTickets(projectId: string, ids: string[], patch: TicketPatch, actor: string) {
  if (!ids.length) return 0;
  if (patch.status && !STATUSES.includes(patch.status)) throw new AppError("Invalid status.");
  if (patch.priority && !PRIORITIES.includes(patch.priority)) throw new AppError("Invalid priority.");
  if (patch.assignee_id) {
    const agents = await listAgents(projectId);
    if (!agents.some((a) => a.id === patch.assignee_id)) throw new AppError("That agent is not on this brand.");
  }
  const dues = new Map<string, Awaited<ReturnType<typeof ticketDue>>>();
  if (patch.priority)
    for (const r of await query<{ id: string; created_at: string }>("SELECT id,created_at FROM cx_tickets WHERE project_id=$1 AND id = ANY($2) AND priority<>$3", [projectId, ids, patch.priority]))
      dues.set(r.id, await ticketDue(projectId, patch.priority, r.created_at));
  return transaction(async (q) => {
    const rows = await q<{ id: string; status: string; priority: string; team: string | null; tags: string[]; created_at: string; first_response_at: string | null; assignee_id: string | null }>(
      "SELECT id,status,priority,team,tags,created_at,first_response_at,assignee_id FROM cx_tickets WHERE project_id=$1 AND id = ANY($2)",
      [projectId, ids],
    );
    for (const t of rows) {
      const sets: string[] = ["updated_at=now()"];
      const params: unknown[] = [t.id];
      const set = (col: string, v: unknown, cast = "") => { params.push(v); sets.push(`${col}=$${params.length}${cast}`); };
      const changes: string[] = [];
      if (patch.status && patch.status !== t.status) {
        set("status", patch.status);
        if (patch.status === "solved" || patch.status === "closed") sets.push("resolved_at=COALESCE(resolved_at, now())");
        else sets.push("resolved_at=NULL");
        changes.push(`status → ${patch.status.replace("_", " ")}`);
      }
      if (patch.priority && patch.priority !== t.priority) { set("priority", patch.priority); changes.push(`priority → ${patch.priority}`); }
      if (patch.team !== undefined && (patch.team || null) !== t.team) { set("team", patch.team || null); changes.push(`team → ${patch.team || "none"}`); }
      if (patch.assignee_id !== undefined && (patch.assignee_id || null) !== t.assignee_id) { set("assignee_id", patch.assignee_id || null); changes.push(patch.assignee_id ? "assigned" : "unassigned"); }
      if (patch.subject !== undefined) set("subject", patch.subject.slice(0, 300));
      if (patch.csat !== undefined) set("csat", patch.csat);
      let tags = patch.tags ?? t.tags;
      if (patch.addTags) tags = [...new Set([...tags, ...patch.addTags.map((x) => x.trim().toLowerCase()).filter(Boolean)])];
      if (patch.removeTags) tags = tags.filter((x) => !patch.removeTags!.includes(x));
      if (JSON.stringify(tags) !== JSON.stringify(t.tags)) { set("tags", JSON.stringify(tags), "::jsonb"); changes.push(`tags: ${tags.join(", ") || "none"}`); }
      const due = dues.get(t.id);
      if (due) {
        if (!t.first_response_at) set("first_response_due", due.firstResponseDue);
        set("resolution_due", due.resolutionDue);
      }
      await q(`UPDATE cx_tickets SET ${sets.join(",")} WHERE id=$1`, params);
      if (changes.length) await logEvent(q, t.id, actor, "update", changes.join("; "));
    }
    return rows.length;
  });
}

/** Merge source tickets into the target: messages move, sources are closed and tagged "merged". */
export async function mergeTickets(projectId: string, targetId: string, sourceIds: string[], actor: string) {
  const sources = sourceIds.filter((s) => s !== targetId);
  if (!sources.length) throw new AppError("Pick at least one other ticket to merge.");
  return transaction(async (q) => {
    const [target] = await q<{ number: number }>("SELECT number FROM cx_tickets WHERE id=$1 AND project_id=$2", [targetId, projectId]);
    if (!target) throw new AppError("Target ticket not found.", 404);
    const src = await q<{ id: string; number: number; tags: string[] }>("SELECT id,number,tags FROM cx_tickets WHERE project_id=$1 AND id = ANY($2)", [projectId, sources]);
    for (const s of src) {
      await q("UPDATE cx_messages SET ticket_id=$1 WHERE ticket_id=$2", [targetId, s.id]);
      await q("UPDATE cx_mentions SET ticket_id=$1 WHERE ticket_id=$2", [targetId, s.id]);
      await q("UPDATE cx_inbox_chat_sessions SET ticket_id=$1 WHERE ticket_id=$2", [targetId, s.id]);
      await q(`UPDATE cx_tickets SET status='closed', resolved_at=COALESCE(resolved_at,now()), updated_at=now(), tags=CASE WHEN tags ? 'merged' THEN tags ELSE tags || '["merged"]'::jsonb END WHERE id=$1`, [s.id]);
      await insertMessage(q, s.id, { direction: "note", authorName: actor, body: `Merged into ticket #${target.number}.` });
      await logEvent(q, targetId, actor, "merge", `Merged #${s.number} into this ticket`);
    }
    await q("UPDATE cx_tickets SET updated_at=now(), status=CASE WHEN status IN ('solved','closed') THEN 'open' ELSE status END WHERE id=$1", [targetId]);
    return src.length;
  });
}

export async function heartbeat(projectId: string, ticketId: string, user: { id: string; name: string }, typing: boolean) {
  await query(
    `INSERT INTO cx_inbox_presence(ticket_id,user_id,user_name,typing,seen_at) SELECT $1,$2,$3,$4,now() WHERE EXISTS (SELECT 1 FROM cx_tickets WHERE id=$1 AND project_id=$5)
     ON CONFLICT(ticket_id,user_id) DO UPDATE SET seen_at=now(), typing=$4, user_name=$3`,
    [ticketId, user.id, user.name, typing, projectId],
  );
  return query<{ user_id: string; user_name: string; typing: boolean }>("SELECT user_id,user_name,typing FROM cx_inbox_presence WHERE ticket_id=$1 AND user_id<>$2 AND seen_at > now()-interval '25 seconds'", [ticketId, user.id]);
}

// ---------------------------------------------------------------- canned responses

export type Canned = { id: string; title: string; shortcut: string; body: string; uses: number };
export const listCanned = (projectId: string) => query<Canned>("SELECT id,title,shortcut,body,uses FROM cx_inbox_canned WHERE project_id=$1 ORDER BY uses DESC, title", [projectId]);

/** Fill {{name}}, {{first_name}}, {{ticket}}, {{brand}}, {{agent}} placeholders. */
export function fillTemplate(body: string, v: { name?: string | null; ticket?: number; brand?: string; agent?: string }) {
  const first = (v.name ?? "").trim().split(/\s+/)[0] ?? "";
  return body
    .replace(/\{\{\s*first_name\s*\}\}/g, first || "there")
    .replace(/\{\{\s*name\s*\}\}/g, v.name?.trim() || "there")
    .replace(/\{\{\s*ticket\s*\}\}/g, v.ticket != null ? `#${v.ticket}` : "")
    .replace(/\{\{\s*brand\s*\}\}/g, v.brand ?? "")
    .replace(/\{\{\s*agent\s*\}\}/g, v.agent ?? "");
}
