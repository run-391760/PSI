import { query } from "@/lib/db";
import { getClassificationTree } from "@/lib/cx/admin/fields";
import { applyFilters, loadTicketRows, mediaOptions, type ReportCtx } from "./data";
import { asIds, childrenOf, classifiedCounts, levelBreakdown, pathTo, pickNode, type CRow } from "./classifications-model";
import { timeSeries, SENTIMENTS } from "./model";

/**
 * View model of the Classifications report (server-only, serializable output): tickets of the period (scope and
 * media filters applied, exactly like the ticket drill-down) broken down by the brand's classification tree.
 * `?node=<id>` opens a node's sub-classifications.
 */
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export async function classificationsView(ctx: ReportCtx, sp: SP) {
  const { range, interval } = ctx.filters;
  const [raw, nodes] = await Promise.all([loadTicketRows(ctx, range), getClassificationTree(ctx.brandId)]);
  const tickets = applyFilters(ctx, raw);
  const ids = tickets.map((t) => t.ticketId).filter((x): x is string => !!x);
  const fields = ids.length
    ? await query<{ ticket_id: string; classification_ids: unknown }>("SELECT ticket_id,classification_ids FROM cx_admin_ticket_fields WHERE project_id=$1 AND ticket_id = ANY($2::text[])", [ctx.brandId, ids])
    : [];
  const byTicket = new Map(fields.map((f) => [f.ticket_id, asIds(f.classification_ids)]));
  const rows: CRow[] = tickets.map((t) => ({ at: t.at, sentiment: t.sentiment, classes: byTicket.get(t.ticketId ?? "") ?? [] }));

  const node = pickNode(nodes, one(sp.node));
  const level = levelBreakdown(rows, nodes, node);
  const shown = [...level.items].filter((i) => i.total > 0).sort((a, b) => b.total - a.total).slice(0, 8);
  const shownIds = shown.map((s) => s.id);
  const levelRows = node ? rows.filter((r) => r.classes.includes(node)) : rows;
  return {
    empty: tickets.length === 0,
    noTree: nodes.length === 0,
    mediaOptions: mediaOptions(raw, range),
    node,
    path: pathTo(nodes, node).map((n) => ({ id: n.id, label: n.label })),
    topLevel: childrenOf(nodes, null).length,
    counts: classifiedCounts(rows),
    level,
    series: shown.map((s) => ({ key: s.id, label: s.label })),
    trend: timeSeries(levelRows, range, interval, (r) => r.classes, shownIds),
    sentiment: level.items.filter((i) => i.total > 0).map((i) => ({ key: i.id, ...Object.fromEntries(SENTIMENTS.map((s) => [s, i[s]])) }) as Record<string, string | number>),
  };
}
export type ClassificationsView = Awaited<ReturnType<typeof classificationsView>>;
