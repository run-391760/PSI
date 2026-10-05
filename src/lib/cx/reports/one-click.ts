import { query } from "@/lib/db";
import { channelInfo } from "@/lib/cx/channels";
import { mediaLabel } from "@/lib/cx/ops/model";
import { buildXlsx } from "@/lib/cx/inbox/xlsx";
import { applyFilters, loadConversationsRaw, loadTicketRows, mediaOptions, profileNames, type ReportCtx } from "./data";
import { sentimentView, shareOfVoiceView } from "./listening";
import type { Msg } from "./model";
import {
  coverSheet, ONE_CLICK_REPORTS, prefixed, sentimentSheets, sovSheets, ticketingSheets, ticketingSummary, uniqueSheetNames, workbookName,
  type OneClickChoice, type OneClickReport, type Sheet,
} from "./one-click-model";

/**
 * One-Click Report (server-only): runs the Share of Voice, Sentiment Analysis and Ticketing report views for
 * the URL filters (period, scope, media, basis) and writes them into one XLSX workbook, one sheet per widget.
 */

/** Tickets in the period (scope + media filters), as the Ticketing report counts them. */
export async function ticketRows(ctx: ReportCtx) {
  return applyFilters(ctx, await loadTicketRows(ctx, ctx.filters.range));
}

/** Ticketing report numbers: statistics, reply TAT, trend per profile, first-time resolution. */
export async function ticketingView(ctx: ReportCtx) {
  const rows = await ticketRows(ctx);
  const ids = [...new Set(rows.map((r) => r.ticketId).filter((x): x is string => !!x))];
  const [msgs, meta, names] = await Promise.all([
    ids.length
      ? query<{ ticket_id: string; direction: Msg["direction"]; created_at: string }>("SELECT ticket_id,direction,created_at FROM cx_messages WHERE ticket_id = ANY($1::text[]) AND direction IN ('in','out')", [ids])
      : Promise.resolve([]),
    ids.length ? query<{ ticket_id: string; reopen_count: number }>("SELECT ticket_id,reopen_count FROM cx_inbox_ticket_meta WHERE ticket_id = ANY($1::text[])", [ids]) : Promise.resolve([]),
    profileNames(ctx.brandId),
  ]);
  const messages: Msg[] = msgs.map((m) => ({ ticket_id: m.ticket_id, direction: m.direction, created_at: new Date(m.created_at).toISOString() }));
  const reopen = new Map(meta.map((m) => [m.ticket_id, Number(m.reopen_count) || 0]));
  const profileName = (id: string) => names.get(id) ?? (id.startsWith("kind:") ? (channelInfo(id.slice(5))?.name ?? id.slice(5)) : id === "unknown" ? "Unknown profile" : "Removed channel");
  return ticketingSummary(rows, messages, reopen, ctx.filters.range, ctx.filters.interval, profileName);
}

/** What the period holds, so the page can show counts and an empty state before anything is generated. */
export async function oneClickPreview(ctx: ReportCtx) {
  const [raw, tickets] = await Promise.all([loadConversationsRaw(ctx, ctx.filters.range), ticketRows(ctx)]);
  return { conversations: applyFilters(ctx, raw).length, tickets: tickets.length, mediaOptions: mediaOptions(raw, ctx.filters.range) };
}

async function sheetsFor(ctx: ReportCtx, report: OneClickReport): Promise<{ sheets: Sheet[]; empty: boolean }> {
  const interval = ctx.filters.interval;
  if (report === "sov") {
    const v = await shareOfVoiceView(ctx, {});
    return { sheets: sovSheets(v, interval), empty: v.empty };
  }
  if (report === "sentiment") {
    const v = await sentimentView(ctx, {});
    return { sheets: sentimentSheets(v, interval), empty: v.empty };
  }
  const v = await ticketingView(ctx);
  return { sheets: ticketingSheets(v, interval), empty: v.total === 0 };
}

/** The workbook (base64) for one report or all three; `empty` when the period has no data for it. */
export async function buildOneClick(ctx: ReportCtx, choice: OneClickChoice, now = new Date()) {
  const reports = choice === "all" ? ONE_CLICK_REPORTS : ONE_CLICK_REPORTS.filter((r) => r.id === choice);
  const parts = await Promise.all(reports.map((r) => sheetsFor(ctx, r.id)));
  const label = choice === "all" ? "All reports" : reports[0].label;
  const empty = parts.every((p) => p.empty);
  const cover = coverSheet({
    report: choice === "all" ? `${label} (${reports.map((r) => r.label).join(", ")})` : label,
    brand: ctx.brandName,
    range: ctx.filters.range,
    scope: ctx.scope.isDefault ? `All of ${ctx.brandName}` : ctx.scope.label,
    media: ctx.filters.media.map(mediaLabel),
    basis: ctx.filters.basis,
    interval: ctx.filters.interval,
    generatedAt: now,
  });
  const body = choice === "all" ? parts.flatMap((p, i) => prefixed(reports[i].prefix, p.sheets)) : parts[0].sheets;
  const sheets = uniqueSheetNames([cover, ...body]);
  return {
    empty,
    name: workbookName(ctx.brandName, label, ctx.filters.range),
    sheets: sheets.map((s) => s.name),
    data: buildXlsx(sheets).toString("base64"),
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}
