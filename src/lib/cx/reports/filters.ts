/**
 * Report filter state (pure, client-safe). Every filter lives in the URL:
 *   ?brand=…&from=yyyy-mm-dd&to=yyyy-mm-dd&media=news,email&basis=publish|created&interval=day|week|month
 * plus the shared ScopePicker's ?scope= (passed through untouched).
 */
import { parseMediaParam } from "@/lib/cx/ops/model";
import { isInterval, parseRange, type Basis, type Interval, type Range } from "./model";

/** Params owned by the shared ScopePicker (cluster/topic/profile selection). Kept verbatim in drill specs. */
export const SCOPE_PARAMS = ["scope"] as const;
/** Every param the report filter bar owns (used to carry filters between report pages). */
export const FILTER_PARAMS = ["from", "to", "media", "basis", "interval", ...SCOPE_PARAMS] as const;

export type ReportFilters = { range: Range; media: string[]; basis: Basis; interval: Interval; scope: Record<string, string> };
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function readFilters(sp: SP, today: string, opts: { defDays?: number; interval?: Interval } = {}): ReportFilters {
  const scope: Record<string, string> = {};
  for (const k of SCOPE_PARAMS) {
    const v = one(sp[k]);
    if (v) scope[k] = v;
  }
  const interval = one(sp.interval);
  return {
    range: parseRange({ from: one(sp.from), to: one(sp.to) }, today, opts.defDays ?? 7),
    media: parseMediaParam(one(sp.media)),
    basis: one(sp.basis) === "created" ? "created" : "publish",
    interval: isInterval(interval) ? interval : (opts.interval ?? "day"),
    scope,
  };
}

/** Query string of the scope + media filters (what a drill spec needs to re-resolve rows on the server). */
export function filterQuery(f: Pick<ReportFilters, "media" | "scope">) {
  const p = new URLSearchParams(f.scope);
  if (f.media.length) p.set("media", f.media.join(","));
  return p.toString();
}
export function parseFilterQuery(q: string | undefined): SP {
  const out: SP = {};
  if (!q) return out;
  for (const [k, v] of new URLSearchParams(q)) out[k] = v;
  return out;
}

/** Today's date (yyyy-mm-dd) in a timezone offset given in minutes. */
export const localToday = (offsetMin: number, now = new Date()) => new Date(now.getTime() + offsetMin * 60000).toISOString().slice(0, 10);
