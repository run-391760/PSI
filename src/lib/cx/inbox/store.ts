import { randomUUID } from "node:crypto";
import { query, transaction, type Query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { analyzeText } from "@/lib/cx/ai";
import { getTicketFields } from "@/lib/cx/admin/fields";
import { evaluateRules, type Rule } from "./rules";
import { agentsOf, listTeams as insightsTeams } from "@/lib/cx/insights/team";
import { slaDueDates, slaTargetMap } from "@/lib/cx/insights/sla";
import { withDefaults } from "./sla";
import { crmLabel, effectiveStatus, fillTemplate as fill, isCrmStatus, isTicketLocked, parseSearch, phoneKey, reopenOnInbound, toStored, type CrmStatus, type SearchTerm } from "./model";
import { getInboxSettings } from "./settings";
import { groupScope, groupTicketSql } from "@/lib/cx/ops/groups";
import { MEDIA_SQL } from "@/lib/cx/ops/media";
import { parseMediaParam } from "@/lib/cx/ops/model";

/**
 * Tickets, messages and contacts of the CX inbox (server only). All functions take a projectId the
 * caller has already verified (getProject) and scope every statement to it.
 */
export const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
export const STATUSES = ["new", "open", "pending", "on_hold", "solved", "closed"] as const;
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type { CrmStatus };

export type Attachment = { id?: string; name?: string; type?: string; size?: number; url?: string };
export type TicketListRow = {
  id: string; number: number; subject: string; status: Status; priority: Priority; channel_kind: string; channel_id: string | null; channel_name: string | null;
  contact_id: string | null; contact_name: string | null; contact_email: string | null; assignee_id: string | null; assignee_name: string | null;
  team: string | null; tags: string[]; sentiment: string | null; intent: string | null; language: string | null;
  first_response_due: string | null; resolution_due: string | null; first_response_at: string | null; resolved_at: string | null;
  csat: number | null; created_at: string; updated_at: string; last_body: string | null; last_direction: string | null; last_at: string | null; messages: number;
  crm_status: CrmStatus; overlay: string | null; severity: string | null; parent_id: string | null; children: number; escalated_at: string | null;
  has_attachment: boolean; next_reminder: string | null; emails_sent: number;
  media_type: string; first_body: string | null; first_at: string | null; first_author: string | null; contact_handle: string | null;
  post_key: string | null; post_url: string | null; post_tickets: number; bookmarked: boolean; tasks_open: number;
};
export type MessageRow = { id: string; direction: "in" | "out" | "note"; author_name: string; author_user_id: string | null; body: string; html: string | null; attachments: Attachment[]; delivery: string; delivery_error: string | null; created_at: string; reply_to?: string | null; mentions?: string[]; from_ticket?: number | null };

const DONE = "('solved','closed')";
/** Effective CRM status in SQL (mirrors model.effectiveStatus). Needs aliases t (ticket) and tm (meta). */
export const CRM_SQL = `(CASE WHEN tm.crm_status IN ('wip','reopened') AND t.status IN ('new','open') THEN tm.crm_status
  WHEN tm.crm_status='follow_up' AND t.status='pending' THEN 'follow_up'
  WHEN tm.crm_status='ignored' AND t.status='closed' THEN 'ignored'
  WHEN t.status IN ('new','open') AND (SELECT x.direction FROM cx_messages x WHERE x.ticket_id=t.id AND x.direction<>'note' ORDER BY x.created_at DESC, x.id DESC LIMIT 1)='out' THEN 'responded'
  WHEN t.status IN ('new','open') AND t.assignee_id IS NOT NULL THEN 'assigned'
  ELSE t.status END)`;
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

export type SortKey = "priority" | "sla" | "newest" | "oldest" | "updated" | "latest";
export type TicketFilters = {
  view?: View; q?: string; channel?: string; priority?: string; status?: string; tag?: string; team?: string; assignee?: string; sentiment?: string;
  from?: string; to?: string; profile?: string; topic?: string; escalated?: string; email?: string; severity?: string; sort?: SortKey | string;
  /** Profile group id (cx_ops_profile_groups), media types (comma list, see ops/model MEDIA_TYPES), post key (cx_ops_ticket_posts). */
  group?: string; media?: string; post?: string;
};
const normStatus = (v: string) => { const s = v.toLowerCase().replace(/[- ]/g, "_"); return s === "resolved" ? "solved" : s === "work_in_progress" ? "wip" : s === "followup" ? "follow_up" : s; };
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** SQL condition for one `field:value` search term (null = not SQL-backed, e.g. custom fields). */
function termSql(term: SearchTerm, p: (v: unknown) => string, userParam: string, lockDaysParam: string): string | null {
  const v = term.value.trim();
  const like = () => p(`%${v}%`);
  switch (term.field) {
    case "status": return `${CRM_SQL}=${p(normStatus(v))}`;
    case "priority": return `t.priority=${p(v.toLowerCase())}`;
    case "severity": return `lower(tm.severity)=${p(v.toLowerCase())}`;
    case "channel": return `t.channel_kind ILIKE ${like()}`;
    case "profile": return `ch.name ILIKE ${like()}`;
    case "assignee": return v.toLowerCase() === "me" ? `t.assignee_id=${userParam}::text` : v.toLowerCase() === "none" ? "t.assignee_id IS NULL" : `(u.name ILIKE ${like()} OR u.email ILIKE ${like()})`;
    case "team": return `t.team ILIKE ${like()}`;
    case "tag": return `t.tags ? ${p(v.toLowerCase())}`;
    case "sentiment": return `t.sentiment=${p(v.toLowerCase())}`;
    case "intent": return `t.intent=${p(v.toLowerCase())}`;
    case "lang": return `t.language=${p(v.toLowerCase())}`;
    case "email": return `c.email ILIKE ${like()}`;
    case "phone": { const d = v.replace(/\D/g, ""); return d ? `regexp_replace(coalesce(c.phone,''),'\\D','','g') LIKE ${p(`%${d}%`)}` : "false"; }
    case "name": return `c.name ILIKE ${like()}`;
    case "subject": return `t.subject ILIKE ${like()}`;
    case "ticket": return /^\d{1,9}$/.test(v.replace(/^#/, "")) ? `t.number=${p(Number(v.replace(/^#/, "")))}` : "false";
    case "post": {
      const x = like(), exact = p(v);
      return `(EXISTS (SELECT 1 FROM cx_mentions mn WHERE mn.ticket_id=t.id AND (mn.url ILIKE ${x} OR mn.external_id=${exact})) OR EXISTS (SELECT 1 FROM cx_messages mx WHERE mx.ticket_id=t.id AND (mx.external_id=${exact} OR mx.external_id ILIKE ${x})) OR t.external_thread_id=${exact})`;
    }
    case "topic": return `EXISTS (SELECT 1 FROM cx_mentions mn JOIN cx_topics tp ON tp.id=mn.topic_id WHERE mn.ticket_id=t.id AND tp.name ILIKE ${like()})`;
    case "is":
      switch (v.toLowerCase()) {
        case "escalated": return "tm.escalated_at IS NOT NULL";
        case "unassigned": return "t.assignee_id IS NULL";
        case "mine": return `t.assignee_id=${userParam}::text`;
        case "parent": return "EXISTS (SELECT 1 FROM cx_inbox_ticket_meta k WHERE k.parent_id=t.id)";
        case "child": return "tm.parent_id IS NOT NULL";
        case "locked": return `(${lockDaysParam}::int > 0 AND t.status IN ${DONE} AND t.resolved_at < now() - make_interval(days => ${lockDaysParam}::int))`;
        default: return "false";
      }
    case "has":
      switch (v.toLowerCase()) {
        case "attachment": case "attachments": return "EXISTS (SELECT 1 FROM cx_messages ma WHERE ma.ticket_id=t.id AND ma.attachments <> '[]'::jsonb)";
        case "reminder": case "reminders": return "EXISTS (SELECT 1 FROM cx_inbox_reminders r WHERE r.ticket_id=t.id AND r.fired_at IS NULL)";
        case "children": return "EXISTS (SELECT 1 FROM cx_inbox_ticket_meta k WHERE k.parent_id=t.id)";
        case "csat": return "t.csat IS NOT NULL";
        default: return "false";
      }
    case "after": return isDate(v) ? `t.created_at >= ${p(v)}::date` : "false";
    case "before": return isDate(v) ? `t.created_at < ${p(v)}::date` : "false";
    default: return null;
  }
}

type WhereOpts = { fieldKeys?: string[]; ids?: string[]; omit?: ("view" | "status" | "assignee" | "media")[] };
/** WHERE clause for the ticket list and its facet counters (aliases t, tm, c, ch, u). `omit` drops facets for counters. */
async function ticketWhere(projectId: string, userId: string, f: TicketFilters, opts: WhereOpts = {}) {
  const settings = await getInboxSettings(projectId);
  const omit = new Set(opts.omit ?? []);
  const params: unknown[] = [projectId, userId, settings.lockDays];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const where = [`t.project_id=$1`, `$2::text IS NOT NULL`, `$3::int IS NOT NULL`];
  if (opts.ids) where.push(`t.id = ANY(${p(opts.ids)})`);
  else if (!omit.has("view")) where.push(viewSql((f.view as View) ?? "open", "$2"));
  if (f.channel) where.push(`t.channel_kind=${p(f.channel)}`);
  if (f.priority) where.push(`t.priority=${p(f.priority)}`);
  if (f.status && !omit.has("status")) where.push(`${CRM_SQL}=${p(normStatus(f.status))}`);
  if (f.team) where.push(`t.team=${p(f.team)}`);
  if (f.sentiment) where.push(`t.sentiment=${p(f.sentiment)}`);
  if (f.assignee && !omit.has("assignee")) where.push(f.assignee === "none" ? "t.assignee_id IS NULL" : `t.assignee_id=${p(f.assignee)}`);
  if (f.tag) where.push(`t.tags ? ${p(f.tag)}`);
  if (f.severity) where.push(`lower(tm.severity)=${p(f.severity.toLowerCase())}`);
  if (isDate(f.from)) where.push(`t.created_at >= ${p(f.from)}::date`);
  if (isDate(f.to)) where.push(`t.created_at < (${p(f.to)}::date + 1)`);
  if (f.profile) where.push(`t.channel_id=${p(f.profile)}`);
  if (f.topic) where.push(`EXISTS (SELECT 1 FROM cx_mentions mn WHERE mn.ticket_id=t.id AND mn.topic_id=${p(f.topic)})`);
  if (f.escalated === "1") where.push("tm.escalated_at IS NOT NULL");
  if (f.escalated === "0") where.push("tm.escalated_at IS NULL");
  if (f.group && f.group !== "all") {
    const scope = await groupScope(projectId, f.group);
    where.push(scope ? groupTicketSql(scope, p) : "false");
  }
  const media = parseMediaParam(f.media);
  if (media.length && !omit.has("media")) where.push(`${MEDIA_SQL} = ANY(${p(media)}::text[])`);
  if (f.post) where.push(`EXISTS (SELECT 1 FROM cx_ops_ticket_posts tp WHERE tp.ticket_id=t.id AND tp.post_key=${p(f.post)})`);
  const SENT = "EXISTS (SELECT 1 FROM cx_inbox_emails e WHERE e.ticket_id=t.id AND e.status='sent')";
  const RECEIVED = "EXISTS (SELECT 1 FROM cx_messages mi WHERE mi.ticket_id=t.id AND mi.direction='in' AND mi.created_at > (SELECT min(e.created_at) FROM cx_inbox_emails e WHERE e.ticket_id=t.id AND e.status='sent'))";
  if (f.email === "sent") where.push(`${SENT} AND NOT ${RECEIVED}`);
  if (f.email === "received") where.push(RECEIVED);
  if (f.email === "not_sent") where.push(`NOT ${SENT}`);
  const parsed = parseSearch(f.q ?? "", opts.fieldKeys ?? []);
  const fieldTerms: SearchTerm[] = [];
  for (const term of parsed.terms) {
    const sql = termSql(term, p, "$2", "$3");
    if (sql == null) { fieldTerms.push(term); continue; }
    where.push(term.neg ? `NOT COALESCE((${sql}), false)` : sql);
  }
  if (parsed.text) {
    const q = parsed.text.replace(/^#/, "");
    const x = p(`%${q}%`), n = p(/^\d{1,9}$/.test(q) ? Number(q) : -1);
    where.push(`(t.subject ILIKE ${x} OR c.name ILIKE ${x} OR c.email ILIKE ${x} OR c.phone ILIKE ${x} OR t.number=${n} OR EXISTS (SELECT 1 FROM cx_messages mm WHERE mm.ticket_id=t.id AND mm.body ILIKE ${x}))`);
  }
  return { where, params, p, fieldTerms };
}
const FROM_TICKETS = `FROM cx_tickets t
       LEFT JOIN cx_inbox_ticket_meta tm ON tm.ticket_id=t.id
       LEFT JOIN cx_contacts c ON c.id=t.contact_id
       LEFT JOIN cx_channels ch ON ch.id=t.channel_id
       LEFT JOIN users u ON u.id=t.assignee_id`;

export async function listTickets(projectId: string, userId: string, f: TicketFilters, limit = 300, opts: { fieldKeys?: string[]; ids?: string[] } = {}) {
  const { where, params, p, fieldTerms } = await ticketWhere(projectId, userId, f, opts);
  const order =
    f.sort === "sla" ? `CASE WHEN t.status IN ${DONE} THEN 1 ELSE 0 END, LEAST(CASE WHEN t.first_response_at IS NULL THEN t.first_response_due END, t.resolution_due) ASC NULLS LAST, t.updated_at DESC`
    : f.sort === "newest" ? "t.created_at DESC"
    : f.sort === "oldest" ? "t.created_at ASC"
    : f.sort === "updated" ? "t.updated_at DESC"
    : f.sort === "latest" ? "COALESCE(lm.created_at, t.updated_at) DESC"
    : "CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, t.updated_at DESC";
  const lim = p(fieldTerms.length ? Math.max(limit, 2000) : limit);
  const rows = await query<TicketListRow>(
    `SELECT t.id,t.number,t.subject,t.status,t.priority,t.channel_kind,t.channel_id,ch.name AS channel_name,t.contact_id,c.name AS contact_name,c.email AS contact_email,
            t.assignee_id,u.name AS assignee_name,t.team,t.tags,t.sentiment,t.intent,t.language,t.first_response_due,t.resolution_due,t.first_response_at,t.resolved_at,
            t.csat,t.created_at,t.updated_at,lm.body AS last_body,lm.direction AS last_direction,lm.created_at AS last_at,
            (SELECT count(*)::int FROM cx_messages x WHERE x.ticket_id=t.id AND x.direction<>'note') AS messages,
            ${CRM_SQL} AS crm_status, tm.crm_status AS overlay, tm.severity, tm.parent_id, tm.escalated_at,
            (SELECT count(*)::int FROM cx_inbox_ticket_meta k WHERE k.parent_id=t.id) AS children,
            EXISTS (SELECT 1 FROM cx_messages ma WHERE ma.ticket_id=t.id AND ma.attachments <> '[]'::jsonb) AS has_attachment,
            (SELECT min(r.remind_at) FROM cx_inbox_reminders r WHERE r.ticket_id=t.id AND r.fired_at IS NULL) AS next_reminder,
            (SELECT count(*)::int FROM cx_inbox_emails e WHERE e.ticket_id=t.id AND e.status='sent') AS emails_sent,
            ${MEDIA_SQL} AS media_type, fm.body AS first_body, fm.created_at AS first_at, fm.author_name AS first_author,
            (SELECT value FROM jsonb_each_text(COALESCE(c.handles,'{}'::jsonb)) LIMIT 1) AS contact_handle,
            tp.post_key, tp.post_url,
            (CASE WHEN tp.post_key IS NULL THEN 0 ELSE (SELECT count(*)::int FROM cx_ops_ticket_posts tq WHERE tq.project_id=t.project_id AND tq.post_key=tp.post_key) END) AS post_tickets,
            EXISTS (SELECT 1 FROM cx_ops_bookmarks b WHERE b.ticket_id=t.id AND b.user_id=$2 AND b.message_id IS NULL) AS bookmarked,
            (SELECT count(*)::int FROM cx_ops_tasks k WHERE k.ticket_id=t.id AND k.status NOT IN ('done','cancelled')) AS tasks_open
       ${FROM_TICKETS}
       LEFT JOIN cx_ops_ticket_posts tp ON tp.ticket_id=t.id
       LEFT JOIN LATERAL (SELECT body,direction,created_at FROM cx_messages m WHERE m.ticket_id=t.id AND m.direction<>'note' ORDER BY created_at DESC LIMIT 1) lm ON true
       LEFT JOIN LATERAL (SELECT body,created_at,author_name FROM cx_messages m WHERE m.ticket_id=t.id AND m.direction<>'note' ORDER BY created_at, id LIMIT 1) fm ON true
      WHERE ${where.join(" AND ")}
      ORDER BY ${order}
      LIMIT ${lim}`,
    params,
  );
  let out = rows.map(normTicket);
  if (fieldTerms.length) {
    const kept: TicketListRow[] = [];
    for (const r of out) {
      const vals = await getTicketFields(r.id).catch(() => ({ values: {} as Record<string, unknown> }));
      const lower = Object.fromEntries(Object.entries(vals.values ?? {}).map(([k, v]) => [k.toLowerCase(), String(Array.isArray(v) ? v.join(" ") : v ?? "").toLowerCase()]));
      if (fieldTerms.every((t) => { const hit = (lower[t.field] ?? "").includes(t.value.toLowerCase()); return t.neg ? !hit : hit; })) kept.push(r);
      if (kept.length >= limit) break;
    }
    out = kept;
  }
  return out;
}

export type PanelCounts = {
  total: number; responded: number;
  status: { open: number; assigned: number; wip: number; pending: number; closed: number; resolved: number; new: number };
  unassigned: number; agents: { id: string; name: string; n: number }[]; media: { id: string; n: number }[];
};
/**
 * Counters of the filter panel (Konnect "Ticketing View / Ticket Status / Active Users / Media Type"): computed on the
 * current scope (profile group, dates, search and other filters) without the view, status, assignee and media facets,
 * so every counter stays clickable. Custom-field search terms are ignored here.
 */
export async function panelCounts(projectId: string, userId: string, f: TicketFilters, opts: { fieldKeys?: string[] } = {}): Promise<PanelCounts> {
  const { where, params } = await ticketWhere(projectId, userId, f, { ...opts, omit: ["view", "status", "assignee", "media"] });
  const w = where.join(" AND ");
  const [r] = await query<{ total: number; responded: number; open: number; assigned: number; wip: number; pending: number; closed: number; resolved: number; new: number; unassigned: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE x.crm='responded')::int AS responded,
            count(*) FILTER (WHERE x.status IN ('new','open'))::int AS open,
            count(*) FILTER (WHERE x.crm='assigned')::int AS assigned,
            count(*) FILTER (WHERE x.crm='wip')::int AS wip,
            count(*) FILTER (WHERE x.status IN ('pending','on_hold'))::int AS pending,
            count(*) FILTER (WHERE x.status='closed')::int AS closed,
            count(*) FILTER (WHERE x.status='solved')::int AS resolved,
            count(*) FILTER (WHERE x.status='new')::int AS new,
            count(*) FILTER (WHERE x.assignee_id IS NULL AND x.status NOT IN ${DONE})::int AS unassigned
       FROM (SELECT t.status, t.assignee_id, ${CRM_SQL} AS crm ${FROM_TICKETS} WHERE ${w}) x`,
    params,
  );
  const agents = await query<{ id: string; name: string; n: number }>(
    `SELECT t.assignee_id AS id, COALESCE(NULLIF(u.name,''),u.email) AS name, count(*)::int AS n ${FROM_TICKETS} WHERE ${w} AND t.assignee_id IS NOT NULL AND t.status NOT IN ${DONE} GROUP BY 1,2 ORDER BY 3 DESC, 2`,
    params,
  );
  const media = await query<{ id: string; n: number }>(`SELECT ${MEDIA_SQL} AS id, count(*)::int AS n ${FROM_TICKETS} WHERE ${w} GROUP BY 1 ORDER BY 2 DESC`, params);
  return { total: r.total, responded: r.responded, status: { open: r.open, assigned: r.assigned, wip: r.wip, pending: r.pending, closed: r.closed, resolved: r.resolved, new: r.new }, unassigned: r.unassigned, agents, media };
}

function normTicket<T extends Record<string, unknown>>(r: T) {
  const o: Record<string, unknown> = { ...r };
  for (const k of ["first_response_due", "resolution_due", "first_response_at", "resolved_at", "created_at", "updated_at", "last_at", "escalated_at", "next_reminder", "first_at"]) if (k in o) o[k] = iso(o[k]);
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
    if (a.length) return a.map((x) => ({ id: x.id, name: x.name || x.email, email: x.email }));
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
export async function listSeverities(projectId: string): Promise<string[]> {
  const rows = await query<{ s: string }>("SELECT DISTINCT tm.severity AS s FROM cx_inbox_ticket_meta tm JOIN cx_tickets t ON t.id=tm.ticket_id WHERE t.project_id=$1 AND tm.severity IS NOT NULL ORDER BY 1", [projectId]);
  return rows.map((r) => r.s);
}

// ---------------------------------------------------------------- contacts

export type ContactInput = { name?: string | null; email?: string | null; phone?: string | null; handle?: { kind: string; id: string } | null; attributes?: Record<string, string> };
const PHONE_KEY_SQL = "right(regexp_replace(coalesce(phone,''),'\\D','','g'),10)";

export async function upsertContact(q: Query, projectId: string, c: ContactInput) {
  const email = c.email?.trim().toLowerCase() || null;
  const phone = c.phone?.replace(/[^\d+]/g, "") || null;
  const pk = phoneKey(phone);
  let found: { id: string } | undefined;
  if (email) [found] = await q<{ id: string }>("SELECT id FROM cx_contacts WHERE project_id=$1 AND lower(email)=$2", [projectId, email]);
  if (!found && c.handle?.id) [found] = await q<{ id: string }>("SELECT id FROM cx_contacts WHERE project_id=$1 AND handles->>$2=$3", [projectId, c.handle.kind, c.handle.id]);
  if (!found && pk) [found] = await q<{ id: string }>(`SELECT id FROM cx_contacts WHERE project_id=$1 AND ${PHONE_KEY_SQL}=$2 ORDER BY first_seen LIMIT 1`, [projectId, pk]);
  const handles = c.handle?.id ? JSON.stringify({ [c.handle.kind]: c.handle.id }) : "{}";
  const attrs = JSON.stringify(c.attributes ?? {});
  let id: string;
  if (found) {
    await q(
      `UPDATE cx_contacts SET last_seen=now(), name=CASE WHEN name='' THEN $2 ELSE name END, email=COALESCE(email,$3), phone=COALESCE(phone,$4),
              handles=handles || $5::jsonb, attributes=$6::jsonb || attributes WHERE id=$1`,
      [found.id, c.name?.trim() ?? "", email, phone, handles, attrs],
    );
    id = found.id;
  } else {
    id = randomUUID();
    await q(
      "INSERT INTO cx_contacts(id,project_id,name,email,phone,handles,attributes) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)",
      [id, projectId, c.name?.trim() || email?.split("@")[0] || phone || "Visitor", email, phone, handles, attrs],
    );
  }
  if (pk) await autoMergePhone(q, projectId, id);
  return id;
}

/** Auto-merge (setting "Merge contacts sharing a phone number"): other contacts with the same phone key merge into `id`. */
export async function autoMergePhone(q: Query, projectId: string, id: string) {
  const settings = await getInboxSettings(projectId, q);
  if (!settings.autoMergePhone) return 0;
  const [me] = await q<{ phone: string | null; email: string | null }>("SELECT phone,email FROM cx_contacts WHERE id=$1 AND project_id=$2", [id, projectId]);
  const pk = phoneKey(me?.phone);
  if (!pk) return 0;
  // Never merge two contacts that both carry different email addresses: they are different people sharing a line.
  const others = await q<{ id: string }>(
    `SELECT id FROM cx_contacts WHERE project_id=$1 AND id<>$2 AND ${PHONE_KEY_SQL}=$3 AND (email IS NULL OR $4::text IS NULL OR lower(email)=lower($4))`,
    [projectId, id, pk, me?.email ?? null],
  );
  if (!others.length) return 0;
  return mergeContactsQ(q, projectId, id, others.map((o) => o.id));
}

/** Merge contacts inside a transaction: tickets, notes and chat sessions move; fields, handles, tags and attributes combine. */
export async function mergeContactsQ(q: Query, projectId: string, targetId: string, sourceIds: string[]) {
  const sources = sourceIds.filter((s) => s !== targetId);
  if (!sources.length) return 0;
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
  parentId?: string | null;
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
    if (input.parentId) await q("INSERT INTO cx_inbox_ticket_meta(ticket_id,parent_id) VALUES($1,$2) ON CONFLICT(ticket_id) DO UPDATE SET parent_id=$2", [id, input.parentId]);
    if (matched.length) {
      await q("UPDATE cx_inbox_rules SET hits=hits+1, last_hit_at=now() WHERE id = ANY($1)", [matched]);
      const names = rules.filter((r) => matched.includes(r.id)).map((r) => r.name).join(", ");
      await logEvent(q, id, "Automation", "rules", `Applied: ${names}`);
    }
    return { id, number: n, contactId, due };
  });
  await scheduleSlaChecks(input.projectId, result.id, ...[result.due.firstResponseDue, result.due.resolutionDue].filter((d): d is string => !!d)).catch(() => {});
  // Admin automation hooks (WP2): never block ingestion.
  try {
    const { onTicketCreated } = await import("@/lib/cx/admin/hooks");
    await onTicketCreated(input.projectId, result.id);
  } catch (e) {
    console.error("[cx inbox] onTicketCreated hook", e);
  }
  return result;
}

/** False when an inbound message must start a new ticket: the ticket is closed/ignored or locked after resolution. */
export async function canThreadInto(projectId: string, ticketId: string) {
  const settings = await getInboxSettings(projectId);
  const [t] = await query<{ status: string; resolved_at: string | null }>("SELECT status,resolved_at FROM cx_tickets WHERE id=$1 AND project_id=$2", [ticketId, projectId]);
  if (!t || t.status === "closed") return false;
  return !isTicketLocked({ status: t.status, resolved_at: iso(t.resolved_at) }, settings.lockDays);
}

/**
 * Append an inbound message to a ticket. Resolved, pending, on-hold and follow-up tickets move to
 * Reopened; WIP too when "Reopen WIP on customer reply" is on. Locked tickets keep their status.
 */
export async function addInbound(projectId: string, ticketId: string, m: { body: string; html?: string | null; authorName: string; attachments?: MessageRow["attachments"]; externalId?: string | null; createdAt?: string | null }) {
  const settings = await getInboxSettings(projectId);
  const r = await transaction(async (q) => {
    const [t] = await q<{ id: string; status: string; resolved_at: string | null; overlay: string | null }>(
      "SELECT t.id,t.status,t.resolved_at,tm.crm_status AS overlay FROM cx_tickets t LEFT JOIN cx_inbox_ticket_meta tm ON tm.ticket_id=t.id WHERE t.id=$1 AND t.project_id=$2",
      [ticketId, projectId],
    );
    if (!t) throw new AppError("Ticket not found.", 404);
    await insertMessage(q, ticketId, { direction: "in", ...m });
    const locked = isTicketLocked({ status: t.status, resolved_at: iso(t.resolved_at) }, settings.lockDays);
    const next = locked ? null : reopenOnInbound(t, { reopenWip: settings.reopenWip });
    if (next) {
      await q("UPDATE cx_tickets SET updated_at=now(), status=$2, resolved_at=NULL WHERE id=$1", [ticketId, next.status]);
      await setOverlay(q, ticketId, next.overlay, t.status === "solved");
      await logEvent(q, ticketId, "Customer", "update", "status → Reopened (customer replied)");
    } else {
      await q("UPDATE cx_tickets SET updated_at=now() WHERE id=$1", [ticketId]);
      if (locked) await logEvent(q, ticketId, "Customer", "locked", "Customer wrote on a locked ticket (status unchanged)");
    }
    await q("UPDATE cx_contacts SET last_seen=now() WHERE id=(SELECT contact_id FROM cx_tickets WHERE id=$1)", [ticketId]);
    return { reopened: !!next, locked };
  });
  try {
    const { onCustomerMessage } = await import("@/lib/cx/admin/hooks");
    await onCustomerMessage(projectId, ticketId, m.body);
  } catch (e) {
    console.error("[cx inbox] onCustomerMessage hook", e);
  }
  return r;
}

export async function setOverlay(q: Query, ticketId: string, overlay: string | null, reopened = false) {
  await q(
    `INSERT INTO cx_inbox_ticket_meta(ticket_id,crm_status,reopen_count,updated_at) VALUES($1,$2,$3,now())
     ON CONFLICT(ticket_id) DO UPDATE SET crm_status=$2, reopen_count=cx_inbox_ticket_meta.reopen_count+$3, updated_at=now()`,
    [ticketId, overlay, reopened ? 1 : 0],
  );
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
    [id, ticketId, m.direction, m.authorUserId ?? null, m.authorName, m.body, m.html ?? null, JSON.stringify(m.attachments ?? []), m.externalId ?? null, m.delivery ?? "stored", m.deliveryError ?? null, m.createdAt ?? null],
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

type TicketHead = TicketListRow & { external_thread_id: string | null; contact_phone: string | null; contact_handles: Record<string, string>; contact_tags: string[]; contact_attributes: Record<string, string>; sentiment_manual: boolean | null; reopen_count: number | null; escalated_to: string | null };

export async function getTicket(projectId: string, id: string) {
  const settings = await getInboxSettings(projectId);
  const [t] = await query<TicketHead>(
    `SELECT t.*,ch.name AS channel_name,c.name AS contact_name,c.email AS contact_email,c.phone AS contact_phone,c.handles AS contact_handles,c.tags AS contact_tags,c.attributes AS contact_attributes,u.name AS assignee_name,
            ${CRM_SQL} AS crm_status, tm.crm_status AS overlay, tm.severity, tm.parent_id, tm.escalated_at, tm.escalated_to, tm.sentiment_manual, tm.reopen_count,
            (SELECT count(*)::int FROM cx_inbox_ticket_meta k WHERE k.parent_id=t.id) AS children,
            (SELECT x.direction FROM cx_messages x WHERE x.ticket_id=t.id AND x.direction<>'note' ORDER BY x.created_at DESC LIMIT 1) AS last_direction
       FROM cx_tickets t LEFT JOIN cx_inbox_ticket_meta tm ON tm.ticket_id=t.id LEFT JOIN cx_contacts c ON c.id=t.contact_id LEFT JOIN cx_channels ch ON ch.id=t.channel_id LEFT JOIN users u ON u.id=t.assignee_id
      WHERE t.project_id=$1 AND t.id=$2`,
    [projectId, id],
  );
  if (!t) return null;
  const ticket = normTicket(t);
  const messages = (await query<MessageRow>(
    `SELECT m.id,m.direction,m.author_name,m.author_user_id,m.body,m.html,m.attachments,m.delivery,m.delivery_error,m.created_at,mm.reply_to,COALESCE(mm.mentions,'[]') AS mentions
       FROM cx_messages m LEFT JOIN cx_inbox_message_meta mm ON mm.message_id=m.id WHERE m.ticket_id=$1 ORDER BY m.created_at, m.id`,
    [id],
  )).map((m) => ({ ...m, created_at: iso(m.created_at)! }));
  const events = (await query<{ id: string; actor: string; kind: string; detail: string; created_at: string }>("SELECT id,actor,kind,detail,created_at FROM cx_inbox_events WHERE ticket_id=$1 ORDER BY created_at", [id])).map((e) => ({ ...e, created_at: iso(e.created_at)! }));
  const related = t.contact_id
    ? (await query<{ id: string; number: number; subject: string; status: string; channel_kind: string; created_at: string }>("SELECT id,number,subject,status,channel_kind,created_at FROM cx_tickets WHERE project_id=$1 AND contact_id=$2 AND id<>$3 ORDER BY created_at DESC LIMIT 8", [projectId, t.contact_id, id])).map((r) => ({ ...r, created_at: iso(r.created_at)! }))
    : [];
  const mentions = (await query<{ id: string; source: string; url: string | null; title: string; author: string; published_at: string | null }>("SELECT id,source,url,title,author,published_at FROM cx_mentions WHERE ticket_id=$1 AND project_id=$2 ORDER BY published_at DESC NULLS LAST LIMIT 10", [id, projectId])).map((m) => ({ ...m, published_at: iso(m.published_at) }));
  const [chat] = await query<{ visitor_seen_at: string; visitor_typing_at: string | null; page_url: string | null }>("SELECT visitor_seen_at,visitor_typing_at,page_url FROM cx_inbox_chat_sessions WHERE ticket_id=$1 ORDER BY visitor_seen_at DESC LIMIT 1", [id]);
  // Parent–child family: parent, children, and notes of the other family members merged into this view.
  type Fam = { id: string; number: number; subject: string; status: string; crm_status: CrmStatus; assignee_name: string | null };
  const famSql = `SELECT t.id,t.number,t.subject,t.status,${CRM_SQL} AS crm_status,u.name AS assignee_name FROM cx_tickets t LEFT JOIN cx_inbox_ticket_meta tm ON tm.ticket_id=t.id LEFT JOIN users u ON u.id=t.assignee_id WHERE t.project_id=$1`;
  const [parent] = t.parent_id ? await query<Fam>(`${famSql} AND t.id=$2`, [projectId, t.parent_id]) : [];
  const children = await query<Fam>(`${famSql} AND tm.parent_id=$2 ORDER BY t.number`, [projectId, id]);
  const famIds = [...(parent ? [parent.id] : []), ...children.map((c) => c.id)];
  const familyNotes = famIds.length
    ? (await query<MessageRow & { from_ticket: number }>(
        "SELECT m.id,m.direction,m.author_name,m.author_user_id,m.body,m.html,m.attachments,m.delivery,m.delivery_error,m.created_at,t.number AS from_ticket FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id WHERE m.ticket_id = ANY($1) AND m.direction='note' ORDER BY m.created_at",
        [famIds],
      )).map((m) => ({ ...m, created_at: iso(m.created_at)! }))
    : [];
  const reminders = (await query<{ id: string; remind_at: string; note: string; user_ids: string[]; created_by: string | null; created_by_name: string; fired_at: string | null }>(
    "SELECT id,remind_at,note,user_ids,created_by,created_by_name,fired_at FROM cx_inbox_reminders WHERE ticket_id=$1 ORDER BY remind_at",
    [id],
  )).map((r) => ({ ...r, remind_at: iso(r.remind_at)!, fired_at: iso(r.fired_at) }));
  const emails = (await query<{ id: string; kind: string; to_addrs: string[]; cc_addrs: string[]; bcc_addrs: string[]; subject: string; body: string; attachments: Attachment[]; status: string; error: string | null; sent_by_name: string; created_at: string }>(
    "SELECT id,kind,to_addrs,cc_addrs,bcc_addrs,subject,body,attachments,status,error,sent_by_name,created_at FROM cx_inbox_emails WHERE ticket_id=$1 ORDER BY created_at",
    [id],
  )).map((e) => ({ ...e, created_at: iso(e.created_at)! }));
  const fields = await getTicketFields(id).catch(() => ({ classificationIds: [] as string[], values: {} as Record<string, unknown> }));
  return {
    ticket: { ...ticket, crm_status: effectiveStatus({ status: t.status, overlay: t.overlay, assignee_id: t.assignee_id, last_direction: t.last_direction }) },
    locked: isTicketLocked({ status: t.status, resolved_at: ticket.resolved_at }, settings.lockDays),
    messages, events, related, mentions,
    chat: chat ? { seenAt: iso(chat.visitor_seen_at)!, typingAt: iso(chat.visitor_typing_at), pageUrl: chat.page_url } : null,
    parent: parent ?? null, children, familyNotes, reminders, emails, fields,
  };
}
export type TicketDetail = NonNullable<Awaited<ReturnType<typeof getTicket>>>;

export type TicketPatch = {
  status?: Status | CrmStatus; priority?: Priority; assignee_id?: string | null; team?: string | null; tags?: string[]; addTags?: string[]; removeTags?: string[];
  subject?: string; csat?: number | null; severity?: string | null; sentiment?: "positive" | "neutral" | "negative" | "mixed";
};

export async function updateTickets(projectId: string, ids: string[], patch: TicketPatch, actor: string) {
  if (!ids.length) return 0;
  if (patch.status && (!isCrmStatus(patch.status) || ["assigned", "responded"].includes(patch.status))) throw new AppError("Invalid status.");
  if (patch.priority && !PRIORITIES.includes(patch.priority)) throw new AppError("Invalid priority.");
  if (patch.sentiment && !["positive", "neutral", "negative", "mixed"].includes(patch.sentiment)) throw new AppError("Invalid sentiment.");
  if (patch.assignee_id) {
    const agents = await listAgents(projectId);
    if (!agents.some((a) => a.id === patch.assignee_id)) throw new AppError("That agent is not on this brand.");
  }
  const settings = await getInboxSettings(projectId);
  const target = patch.status ? toStored(patch.status as CrmStatus) : null;
  const dues = new Map<string, Awaited<ReturnType<typeof ticketDue>>>();
  if (patch.priority)
    for (const r of await query<{ id: string; created_at: string }>("SELECT id,created_at FROM cx_tickets WHERE project_id=$1 AND id = ANY($2) AND priority<>$3", [projectId, ids, patch.priority]))
      dues.set(r.id, await ticketDue(projectId, patch.priority, r.created_at));
  return transaction(async (q) => {
    const rows = await q<{ id: string; number: number; status: string; priority: string; team: string | null; tags: string[]; created_at: string; first_response_at: string | null; resolved_at: string | null; assignee_id: string | null; overlay: string | null; severity: string | null; sentiment: string | null; open_children: number }>(
      `SELECT t.id,t.number,t.status,t.priority,t.team,t.tags,t.created_at,t.first_response_at,t.resolved_at,t.assignee_id,t.sentiment,tm.crm_status AS overlay,tm.severity,
              (SELECT count(*)::int FROM cx_inbox_ticket_meta k JOIN cx_tickets ct ON ct.id=k.ticket_id WHERE k.parent_id=t.id AND ct.status NOT IN ${DONE}) AS open_children
         FROM cx_tickets t LEFT JOIN cx_inbox_ticket_meta tm ON tm.ticket_id=t.id WHERE t.project_id=$1 AND t.id = ANY($2)`,
      [projectId, ids],
    );
    const editable = rows.filter((t) => !isTicketLocked({ status: t.status, resolved_at: iso(t.resolved_at) }, settings.lockDays));
    if (rows.length && !editable.length) throw new AppError(`Locked: tickets can't be edited or reopened ${settings.lockDays} days after they were resolved.`, 409);
    if (target && ["solved", "closed"].includes(target.status)) {
      const blocked = editable.filter((t) => t.open_children > 0);
      if (blocked.length) throw new AppError(`Parent ticket${blocked.length > 1 ? "s" : ""} ${blocked.map((b) => `#${b.number}`).join(", ")} stay${blocked.length > 1 ? "" : "s"} open until ${blocked.length > 1 ? "their" : "its"} child tickets are closed.`, 409);
    }
    for (const t of editable) {
      const sets: string[] = ["updated_at=now()"];
      const params: unknown[] = [t.id];
      const set = (col: string, v: unknown, cast = "") => { params.push(v); sets.push(`${col}=$${params.length}${cast}`); };
      const changes: string[] = [];
      if (target) {
        const current = effectiveStatus({ status: t.status, overlay: t.overlay });
        const wanted = patch.status as CrmStatus;
        if (target.status !== t.status || (target.overlay ?? null) !== (["wip", "follow_up", "ignored", "reopened"].includes(current) ? current : null)) {
          if (target.status !== t.status) set("status", target.status);
          if (["solved", "closed"].includes(target.status)) sets.push("resolved_at=COALESCE(resolved_at, now())");
          else sets.push("resolved_at=NULL");
          await setOverlay(q, t.id, target.overlay, ["solved", "closed"].includes(t.status) && !["solved", "closed"].includes(target.status));
          changes.push(`status → ${crmLabel(wanted)}`);
        }
      }
      if (patch.priority && patch.priority !== t.priority) { set("priority", patch.priority); changes.push(`priority → ${patch.priority}`); }
      if (patch.team !== undefined && (patch.team || null) !== t.team) { set("team", patch.team || null); changes.push(`team → ${patch.team || "none"}`); }
      if (patch.assignee_id !== undefined && (patch.assignee_id || null) !== t.assignee_id) { set("assignee_id", patch.assignee_id || null); changes.push(patch.assignee_id ? "assigned" : "unassigned"); }
      if (patch.subject !== undefined) set("subject", patch.subject.slice(0, 300));
      if (patch.csat !== undefined) set("csat", patch.csat);
      if (patch.sentiment && patch.sentiment !== t.sentiment) {
        set("sentiment", patch.sentiment);
        await q("INSERT INTO cx_inbox_ticket_meta(ticket_id,sentiment_manual) VALUES($1,true) ON CONFLICT(ticket_id) DO UPDATE SET sentiment_manual=true, updated_at=now()", [t.id]);
        await logEvent(q, t.id, actor, "sentiment", `Sentiment changed: ${t.sentiment ?? "n/a"} → ${patch.sentiment}`);
      }
      if (patch.severity !== undefined && (patch.severity || null) !== t.severity) {
        await q("INSERT INTO cx_inbox_ticket_meta(ticket_id,severity) VALUES($1,$2) ON CONFLICT(ticket_id) DO UPDATE SET severity=$2, updated_at=now()", [t.id, patch.severity || null]);
        await logEvent(q, t.id, actor, "severity", `Severity changed: ${t.severity ?? "none"} → ${patch.severity || "none"}`);
      }
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
    return editable.length;
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
      await q("UPDATE cx_inbox_reminders SET ticket_id=$1 WHERE ticket_id=$2", [targetId, s.id]);
      await q("UPDATE cx_inbox_emails SET ticket_id=$1 WHERE ticket_id=$2", [targetId, s.id]);
      await q("UPDATE cx_inbox_ticket_meta SET parent_id=$1 WHERE parent_id=$2 AND ticket_id<>$1", [targetId, s.id]);
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

/** Fill {{name}}, {{first_name}}, {{ticket}}, {{brand}}, {{agent}} and custom-field placeholders (see model.fillTemplate). */
export const fillTemplate = fill;
