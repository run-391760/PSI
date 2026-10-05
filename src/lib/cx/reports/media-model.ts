/**
 * Media Type Analysis (WP-K4): pure, client-safe aggregation. Fixture-tested in tests/cx-k4-listening.test.ts.
 * Every number is a count of stored conversations; a % change is null ("n/a") when there is nothing to compare.
 */
import { byMediaType, pctChange, type RRow } from "./model";

type MRow = Pick<RRow, "mediaType" | "sentiment">;

/** Media types ranked by conversations (largest first, ties by id), at most `limit`. */
export function topMediaTypes(rows: MRow[], limit = 8) {
  return byMediaType(rows).slice(0, limit).map((m) => m.mediaType);
}

/** KPI tiles: the top media types of the period with their % change against the previous equal period. */
export function mediaKpis(rows: MRow[], prevRows: MRow[], limit = 5) {
  const before = new Map(byMediaType(prevRows).map((m) => [m.mediaType, m.total]));
  return byMediaType(rows)
    .slice(0, limit)
    .map((m) => ({ mediaType: m.mediaType, value: m.total, previous: before.get(m.mediaType) ?? 0, change: pctChange(m.total, before.get(m.mediaType) ?? 0) }));
}

/** Per media type: counts by sentiment, sentiment percentages and the share of all conversations (%). */
export function mediaTable(rows: MRow[]) {
  const total = rows.length;
  return byMediaType(rows).map((m) => ({ ...m, share: total ? (m.total / total) * 100 : 0 }));
}
export type MediaTableRow = ReturnType<typeof mediaTable>[number];

/** Totals row of the media table (sentiment counts over every media type). */
export function mediaTotals(table: Pick<MediaTableRow, "total" | "positive" | "negative" | "neutral">[]) {
  return table.reduce((s, r) => ({ total: s.total + r.total, positive: s.positive + r.positive, negative: s.negative + r.negative, neutral: s.neutral + r.neutral }), { total: 0, positive: 0, negative: 0, neutral: 0 });
}

/** Round a percentage to two decimals for tables and CSV. */
export const pct2 = (v: number) => Math.round(v * 100) / 100;
