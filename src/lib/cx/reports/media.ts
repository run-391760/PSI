import { mediaLabel } from "@/lib/cx/ops/model";
import { applyFilters, loadConversationsRaw, mediaOptions, type ReportCtx } from "./data";
import { mediaKpis, mediaTable, topMediaTypes } from "./media-model";
import { inRange, pctChange, previousRange, timeSeries } from "./model";

/**
 * View model of the Media Type Analysis report (server-only, serializable output). Conversations = listening
 * mentions + tickets (deduped), filtered by scope and media type; every count is a count of stored rows.
 */
export async function mediaTypeView(ctx: ReportCtx) {
  const { range, interval } = ctx.filters;
  const prev = previousRange(range);
  const raw = await loadConversationsRaw(ctx, { from: prev.from, to: range.to });
  const all = applyFilters(ctx, raw);
  const rows = all.filter((r) => inRange(r.at, range));
  const prevRows = all.filter((r) => inRange(r.at, prev));
  const table = mediaTable(rows);
  const series = topMediaTypes(rows, 8);
  const label = (id: string) => mediaLabel(id);
  return {
    empty: rows.length === 0,
    mediaOptions: mediaOptions(raw, range),
    total: { value: rows.length, change: pctChange(rows.length, prevRows.length) },
    kpis: mediaKpis(rows, prevRows, 5).map((k) => ({ ...k, label: label(k.mediaType) })),
    series: series.map((id) => ({ key: id, label: label(id) })),
    moreTypes: Math.max(0, table.length - series.length),
    trend: timeSeries(rows, range, interval, (r) => [r.mediaType], series),
    table: table.map((t) => ({ ...t, label: label(t.mediaType) })),
  };
}
