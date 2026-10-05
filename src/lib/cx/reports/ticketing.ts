import { query } from "@/lib/db";
import { sourceLabel } from "@/lib/cx/listening/sources";
import { applyFilters, loadTicketRows, mediaOptions, profileNames, type ReportCtx } from "./data";
import { buzzStats, firstTimeResolution, outCounts, replyTat, statusTile, ticketStats, timeSeries, type Msg, type RRow } from "./model";

/** Ticketing Report view model (server-only): status tiles, reply TAT, trend per profile, FTR, tracker. */
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
/** Ticket Tracker slices: at most 8 (one per categorical color); follow-up joins pending, ignored joins closed. */
export const TRACKER_GROUPS: { key: string; label: string; tiles: string[] }[] = [
  { key: "open", label: "Open", tiles: ["open"] },
  { key: "wip", label: "WIP", tiles: ["wip"] },
  { key: "assigned", label: "Assigned", tiles: ["assigned"] },
  { key: "responded", label: "Responded", tiles: ["responded"] },
  { key: "pending", label: "Pending / follow-up", tiles: ["pending", "follow_up"] },
  { key: "on_hold", label: "On hold", tiles: ["on_hold"] },
  { key: "solved", label: "Resolved", tiles: ["solved"] },
  { key: "closed", label: "Closed / ignored", tiles: ["closed", "ignored"] },
];

export async function ticketingView(ctx: ReportCtx, sp: SP) {
  const { range, interval } = ctx.filters;
  const raw = await loadTicketRows(ctx, range);
  const rows = applyFilters(ctx, raw);
  const ids = rows.map((r) => r.ticketId!);
  const [msgs, meta, names] = await Promise.all([
    ids.length ? query<Msg>("SELECT ticket_id,direction,created_at FROM cx_messages WHERE ticket_id = ANY($1::text[]) AND direction IN ('in','out') ORDER BY created_at LIMIT 200000", [ids]) : Promise.resolve([] as Msg[]),
    ids.length ? query<{ ticket_id: string; reopen_count: number }>("SELECT ticket_id,reopen_count FROM cx_inbox_ticket_meta WHERE ticket_id = ANY($1::text[])", [ids]) : Promise.resolve([]),
    profileNames(ctx.brandId),
  ]);
  const messages = msgs.map((m) => ({ ...m, created_at: new Date(m.created_at).toISOString() }));
  const reopen = new Map(meta.map((m) => [m.ticket_id, m.reopen_count]));
  const profileName = (p: string) => (p.startsWith("kind:") ? sourceLabel(p.slice(5)).replace(/^\w/, (c) => c.toUpperCase()) : (names.get(p) ?? "Deleted profile"));

  // Ticket trend: one series per profile (top 8 by volume, entity-stable order by volume).
  const byProfile = new Map<string, number>();
  for (const r of rows) byProfile.set(r.profile!, (byProfile.get(r.profile!) ?? 0) + 1);
  const profiles = [...byProfile.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([id, n]) => ({ id, name: profileName(id), count: n }));
  const trend = timeSeries(rows, range, interval, (r) => [r.profile!], profiles.map((p) => p.id));
  const tp = profiles.some((p) => p.id === one(sp.tp)) ? one(sp.tp) : "";
  const statRows = tp ? rows.filter((r) => r.profile === tp) : rows;

  const stats = ticketStats(rows.map((r) => ({ status: r.status ?? "", in_queue: !!r.inQueue, assignee_id: r.agent ?? null })));
  const tracker = TRACKER_GROUPS.map((g) => ({ key: g.key, label: g.label, dim: g.tiles.join(","), value: rows.filter((r) => g.tiles.includes(statusTile(r.status ?? ""))).length }));
  const ftr = firstTimeResolution(rows.map((r) => ({ id: r.ticketId!, status: r.status ?? "", reopen_count: reopen.get(r.ticketId!) ?? 0 })), outCounts(messages));

  return {
    empty: rows.length === 0,
    mediaOptions: mediaOptions(raw, range),
    stats,
    tat: replyTat(messages),
    profiles,
    trend,
    trendStats: { profile: tp, name: tp ? profileName(tp) : ctx.scope.label, ...buzzStats(statRows as RRow[], range) },
    ftr,
    tracker,
    total: rows.length,
  };
}
