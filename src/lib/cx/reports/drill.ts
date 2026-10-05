import { query } from "@/lib/db";
import { buildXlsx, toCsv, type Cell } from "@/lib/cx/inbox/xlsx";
import { mediaLabel } from "@/lib/cx/ops/model";
import { reportContext, loadMentionRows, loadTicketRows, applyFilters, type ReportCtx } from "./data";
import { parseFilterQuery } from "./filters";
import { asSentiment, drillMatches, drillWindow, ftrBucket, outCounts, pageOf, replyTat, refineMatches, SENTIMENT_LABEL, type DrillSpec, type Refine, type RRow, type Sentiment } from "./model";

/**
 * Drill-down (server-only): the items behind a clicked chart slice. The spec is re-resolved against the same
 * loaders the report used, so the drawer lists exactly the rows that were counted.
 *
 *   const page = await drillItems(brand, spec, { page: 1, refine: { q: "refund" } });
 */
export type DrillItem = {
  key: string;
  kind: "mention" | "ticket" | "task" | "survey";
  ticketId: string | null;
  ticketNumber: number | null;
  mentionId: string | null;
  author: string;
  handle: string | null;
  avatar: string | null;
  network: string;
  mediaType: string;
  sentiment: Sentiment | null;
  title: string;
  text: string;
  /** Local-time ISO instant. */
  at: string;
  url: string | null;
  badge?: string | null;
  href?: string | null;
};
const PAGE = 25;

async function ctxFor(brand: { id: string; name: string }, spec: DrillSpec): Promise<ReportCtx> {
  const sp = { ...parseFilterQuery(spec.filters), from: spec.range.from, to: spec.range.to, ...(spec.basis ? { basis: spec.basis } : {}), ...(spec.interval ? { interval: spec.interval } : {}) };
  return reportContext(brand, sp);
}

const fromRow = (r: RRow): DrillItem => ({
  key: r.id,
  kind: r.kind,
  ticketId: r.ticketId,
  ticketNumber: r.ticketNumber,
  mentionId: r.mentionId,
  author: r.author,
  handle: r.handle,
  avatar: r.avatar,
  network: r.network,
  mediaType: r.mediaType,
  sentiment: r.sentiment,
  title: r.title,
  text: r.text,
  at: r.at,
  url: r.url,
  badge: r.kind === "ticket" ? (r.status ?? null) : null,
});

const DAY = 86400000;
const shiftDay = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const utcBounds = (ctx: ReportCtx, r: { from: string; to: string }) => [new Date(Date.parse(`${r.from}T00:00:00Z`) - ctx.offsetMin * 60000), new Date(Date.parse(`${r.to}T23:59:59.999Z`) - ctx.offsetMin * 60000)] as const;

async function conversationItems(ctx: ReportCtx, spec: DrillSpec): Promise<DrillItem[]> {
  const d = spec.dims ?? {};
  const win = drillWindow(spec);
  // Queue events and "unresolved now" are not tied to the ticket's own date: look back a year and select by id/state.
  const wide = spec.source === "tickets" && (d.queue === "queued" || d.queue === "assigned" || d.unresolved === "1");
  const span = wide ? { from: shiftDay(win.to, -365), to: ctx.today > win.to ? ctx.today : win.to } : win;
  const match: DrillSpec = wide ? { ...spec, window: span, bucket: undefined } : spec;
  const wantM = spec.source !== "tickets", wantT = spec.source !== "mentions";
  const [m, t] = await Promise.all([wantM ? loadMentionRows(ctx, span) : [], wantT ? loadTicketRows(ctx, span, { dedupe: spec.source === "conversations" }) : []]);
  let rows = applyFilters(ctx, [...m, ...(spec.source === "conversations" ? t.filter((r) => !r.mentionId) : t)]).filter((r) => drillMatches(r, match));
  if (d.queue === "queued" || d.queue === "assigned") {
    const [a, b] = utcBounds(ctx, win);
    const col = d.queue === "queued" ? "queued_at" : "assigned_at";
    const ids = new Set((await query<{ ticket_id: string }>(`SELECT ticket_id FROM cx_admin_ticket_state WHERE project_id=$1 AND ${col} >= $2 AND ${col} <= $3`, [ctx.brandId, a, b])).map((x) => x.ticket_id));
    rows = rows.filter((r) => r.ticketId && ids.has(r.ticketId));
  }
  if (d.unresolved === "1") rows = rows.filter((r) => r.kind === "ticket" && !["solved", "closed", "ignored"].includes(r.status ?? ""));
  if (d.repliedBy) {
    const [a, b] = utcBounds(ctx, win);
    const ids = new Set((await query<{ ticket_id: string }>("SELECT DISTINCT m.ticket_id FROM cx_messages m JOIN cx_tickets t ON t.id=m.ticket_id WHERE t.project_id=$1 AND m.direction='out' AND m.author_user_id=$2 AND m.created_at >= $3 AND m.created_at <= $4", [ctx.brandId, d.repliedBy, a, b])).map((x) => x.ticket_id));
    if (!wide) {
      // Replies in the window may be on tickets created earlier: reload those tickets by id.
      const extra = ids.size ? (await loadTicketRows(ctx, { from: shiftDay(win.to, -365), to: win.to })).filter((r) => ids.has(r.ticketId!)) : [];
      const seen = new Set(rows.map((r) => r.id));
      rows = [...rows.filter((r) => r.ticketId && ids.has(r.ticketId)), ...applyFilters(ctx, extra).filter((r) => !seen.has(r.id) && drillMatches(r, { ...spec, window: { from: shiftDay(win.to, -365), to: win.to }, bucket: undefined }))];
    } else rows = rows.filter((r) => r.ticketId && ids.has(r.ticketId));
  }
  if (spec.classification === "none") {
    // Unclassified: no classification row, or an empty selection.
    const ids = new Set((await query<{ ticket_id: string }>("SELECT ticket_id FROM cx_admin_ticket_fields WHERE project_id=$1 AND jsonb_array_length(classification_ids) > 0", [ctx.brandId])).map((x) => x.ticket_id));
    rows = rows.filter((r) => r.ticketId && !ids.has(r.ticketId));
  } else if (spec.classification) {
    const ids = new Set(
      (await query<{ ticket_id: string }>("SELECT ticket_id FROM cx_admin_ticket_fields WHERE project_id=$1 AND classification_ids ? $2", [ctx.brandId, spec.classification])).map((x) => x.ticket_id),
    );
    rows = rows.filter((r) => r.ticketId && ids.has(r.ticketId));
    if (spec.dims?.leaf === "1") {
      // "No sub-classification": tagged with this node but with none of its children.
      const kids = new Set(
        (await query<{ ticket_id: string }>(
          "SELECT f.ticket_id FROM cx_admin_ticket_fields f WHERE f.project_id=$1 AND EXISTS (SELECT 1 FROM cx_admin_classifications c WHERE c.parent_id=$2 AND f.classification_ids ? c.id)",
          [ctx.brandId, spec.classification],
        )).map((x) => x.ticket_id),
      );
      rows = rows.filter((r) => !kids.has(r.ticketId!));
    }
  }
  if (spec.ftr) {
    const ids = rows.map((r) => r.ticketId!).filter(Boolean);
    const [msgs, meta] = await Promise.all([
      query<{ ticket_id: string; direction: "in" | "out" | "note"; created_at: string }>("SELECT ticket_id,direction,created_at FROM cx_messages WHERE ticket_id = ANY($1::text[]) AND direction='out'", [ids]),
      query<{ ticket_id: string; reopen_count: number }>("SELECT ticket_id,reopen_count FROM cx_inbox_ticket_meta WHERE ticket_id = ANY($1::text[])", [ids]),
    ]);
    const out = outCounts(msgs.map((x) => ({ ...x, created_at: new Date(x.created_at).toISOString() })));
    const reopen = new Map(meta.map((x) => [x.ticket_id, x.reopen_count]));
    rows = rows.filter((r) => ftrBucket({ status: r.status ?? "", reopen_count: reopen.get(r.ticketId!) ?? 0 }, out.get(r.ticketId!) ?? 0) === spec.ftr);
  }
  const minReplies = Number(spec.dims?.replies ?? 0);
  if (minReplies > 0) {
    const ids = rows.map((r) => r.ticketId!).filter(Boolean);
    const msgs = await query<{ ticket_id: string; direction: "in" | "out" | "note"; created_at: string }>("SELECT ticket_id,direction,created_at FROM cx_messages WHERE ticket_id = ANY($1::text[]) AND direction IN ('in','out')", [ids]);
    const per = replyTat(msgs.map((x) => ({ ...x, created_at: new Date(x.created_at).toISOString() }))).perTicket;
    rows = rows.filter((r) => (per.get(r.ticketId!)?.length ?? 0) >= minReplies);
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at)).map(fromRow);
}

async function taskItems(ctx: ReportCtx, spec: DrillSpec): Promise<DrillItem[]> {
  const win = drillWindow(spec);
  const d = spec.dims ?? {};
  const params: unknown[] = [ctx.brandId, new Date(Date.parse(`${win.from}T00:00:00Z`) - ctx.offsetMin * 60000), new Date(Date.parse(`${win.to}T23:59:59.999Z`) - ctx.offsetMin * 60000)];
  const p = (v: unknown) => (params.push(v), `$${params.length}`);
  const where = ["k.project_id=$1", "k.created_at >= $2", "k.created_at <= $3"];
  if (d.id) where.splice(1, 2, "$2::timestamptz IS NOT NULL", "$3::timestamptz IS NOT NULL", `k.id=${p(d.id)}`);
  if (d.mine) where.push(`k.assignee_id=${p(d.mine)}`);
  if (d.status) where.push(d.status === "open_all" ? "k.status NOT IN ('done','cancelled')" : `k.status=${p(d.status)}`);
  if (d.priority) where.push(`k.priority=${p(d.priority)}`);
  if (d.assignee) where.push(d.assignee === "none" ? "k.assignee_id IS NULL" : `k.assignee_id=${p(d.assignee)}`);
  if (d.classification) where.push(d.classification === "none" ? "k.classification_id IS NULL" : `k.classification_id=${p(d.classification)}`);
  if (d.due === "overdue") where.push("k.due_at < now() AND k.status NOT IN ('done','cancelled')");
  const rows = await query<{ id: string; number: number; title: string; description: string; status: string; priority: string; created_at: string; ticket_id: string | null; ticket_number: number | null; assignee: string | null }>(
    `SELECT k.id,k.number,k.title,k.description,k.status,k.priority,k.created_at,k.ticket_id,t.number AS ticket_number,COALESCE(NULLIF(u.name,''),u.email) AS assignee
       FROM cx_ops_tasks k LEFT JOIN cx_tickets t ON t.id=k.ticket_id LEFT JOIN users u ON u.id=k.assignee_id
      WHERE ${where.join(" AND ")} ORDER BY k.created_at DESC LIMIT 5000`,
    params,
  );
  return rows.map((r) => ({
    key: `k:${r.id}`,
    kind: "task" as const,
    ticketId: r.ticket_id,
    ticketNumber: r.ticket_number,
    mentionId: null,
    author: r.assignee ?? "Unassigned",
    handle: `Task #${r.number}`,
    avatar: null,
    network: "task",
    mediaType: "task",
    sentiment: null,
    title: r.title,
    text: r.description || r.title,
    at: new Date(new Date(r.created_at).getTime() + ctx.offsetMin * 60000).toISOString(),
    url: null,
    badge: r.status,
    href: `/cx/tasks?brand=${ctx.brandId}&view=all&task=${r.id}`,
  }));
}

async function surveyItems(ctx: ReportCtx, spec: DrillSpec): Promise<DrillItem[]> {
  const win = drillWindow(spec);
  const d = spec.dims ?? {};
  const params: unknown[] = [ctx.brandId, new Date(Date.parse(`${win.from}T00:00:00Z`) - ctx.offsetMin * 60000), new Date(Date.parse(`${win.to}T23:59:59.999Z`) - ctx.offsetMin * 60000)];
  const p = (v: unknown) => (params.push(v), `$${params.length}`);
  const where = ["r.project_id=$1", "r.created_at >= $2", "r.created_at <= $3"];
  if (d.id) where.splice(1, 2, "$2::timestamptz IS NOT NULL", "$3::timestamptz IS NOT NULL", `r.id=${p(d.id)}`);
  if (d.survey) where.push(`r.survey_id=${p(d.survey)}`);
  if (d.kind) where.push(`s.kind=${p(d.kind)}`);
  if (d.score) where.push(`r.score=${p(Number(d.score))}`);
  if (d.band === "satisfied") where.push("r.score >= 4");
  if (d.band === "neutral") where.push("r.score = 3");
  if (d.band === "unsatisfied") where.push("r.score <= 2");
  if (d.band === "promoter") where.push("r.score >= 9");
  if (d.band === "passive") where.push("r.score BETWEEN 7 AND 8");
  if (d.band === "detractor") where.push("r.score <= 6");
  if (d.agent) where.push(d.agent === "none" ? "t.assignee_id IS NULL" : `t.assignee_id=${p(d.agent)}`);
  if (spec.sentiment) where.push(`COALESCE(r.sentiment,'neutral')=${p(spec.sentiment)}`);
  const rows = await query<{ id: string; score: number | null; comment: string; sentiment: string | null; created_at: string; ticket_id: string | null; ticket_number: number | null; contact: string | null; avatar_url: string | null; survey: string; channel_kind: string | null }>(
    `SELECT r.id,r.score,r.comment,r.sentiment,r.created_at,r.ticket_id,t.number AS ticket_number,c.name AS contact,c.avatar_url,s.name AS survey,t.channel_kind
       FROM cx_survey_responses r JOIN cx_surveys s ON s.id=r.survey_id LEFT JOIN cx_tickets t ON t.id=r.ticket_id LEFT JOIN cx_contacts c ON c.id=r.contact_id
      WHERE ${where.join(" AND ")} ORDER BY r.created_at DESC LIMIT 5000`,
    params,
  );
  return rows.map((r) => ({
    key: `s:${r.id}`,
    kind: "survey" as const,
    ticketId: r.ticket_id,
    ticketNumber: r.ticket_number,
    mentionId: null,
    author: r.contact ?? "Anonymous",
    handle: r.survey,
    avatar: r.avatar_url,
    network: r.channel_kind ?? "survey",
    mediaType: "survey",
    sentiment: r.sentiment ? asSentiment(r.sentiment) : null,
    title: r.score == null ? "No score" : `Score ${r.score}`,
    text: r.comment || (r.score == null ? "No comment" : `Score ${r.score}, no comment`),
    at: new Date(new Date(r.created_at).getTime() + ctx.offsetMin * 60000).toISOString(),
    url: null,
    badge: r.score == null ? null : String(r.score),
  }));
}

async function allItems(brand: { id: string; name: string }, spec: DrillSpec) {
  const ctx = await ctxFor(brand, spec);
  if (spec.source === "tasks") return taskItems(ctx, spec);
  if (spec.source === "surveys") return surveyItems(ctx, spec);
  return conversationItems(ctx, spec);
}
const refineItem = (i: DrillItem, f?: Refine) => refineMatches({ title: i.title, text: i.text, author: i.author, handle: i.handle, sentiment: i.sentiment ?? "neutral", mediaType: i.mediaType }, f && i.sentiment == null ? { ...f, sentiment: "" } : f);

export async function drillItems(brand: { id: string; name: string }, spec: DrillSpec, opts: { page?: number; refine?: Refine } = {}) {
  const items = (await allItems(brand, spec)).filter((i) => refineItem(i, opts.refine));
  const media = [...new Set(items.map((i) => i.mediaType))];
  return { ...pageOf(items, opts.page ?? 1, PAGE), media };
}

/** Every matching item (up to 5,000) as CSV text or an XLSX workbook (base64). */
export async function drillExport(brand: { id: string; name: string }, spec: DrillSpec, format: "csv" | "xlsx", refine?: Refine) {
  const items = (await allItems(brand, spec)).filter((i) => refineItem(i, refine)).slice(0, 5000);
  const rows: Cell[][] = [
    ["Date (local)", "Author", "Handle", "Network", "Media type", "Sentiment", "Title", "Text", "URL", "Ticket #", "Status"],
    ...items.map((i) => [i.at.slice(0, 16).replace("T", " "), i.author, i.handle, i.network, mediaLabel(i.mediaType), i.sentiment ? SENTIMENT_LABEL[i.sentiment] : "", i.title, i.text, i.url, i.ticketNumber, i.badge ?? ""]),
  ];
  const base = (spec.title || "drill-down").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "drill-down";
  if (format === "xlsx") return { name: `${base}.xlsx`, rows: items.length, data: buildXlsx([{ name: "Items", rows }]).toString("base64"), mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  return { name: `${base}.csv`, rows: items.length, data: toCsv(rows), mime: "text/csv;charset=utf-8" };
}
