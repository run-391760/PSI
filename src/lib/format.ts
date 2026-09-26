/** Display formatting. Safe for server and client components. */

const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const intFmt = new Intl.NumberFormat("en-US");

/** 1,284 / 12.9K / 4.2M / 1.1B. Nullish -> "n/a". */
export function compact(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "n/a";
  if (Math.abs(n) < 10000) return intFmt.format(Math.round(n));
  return compactFmt.format(n);
}
export function num(n: number | null | undefined, digits = 0) {
  if (n == null || Number.isNaN(n)) return "n/a";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
export function pct(n: number | null | undefined, digits = 1, signed = false) {
  if (n == null || Number.isNaN(n)) return "n/a";
  const s = `${n.toFixed(digits)}%`;
  return signed && n > 0 ? `+${s}` : s;
}
export function money(n: number | null | undefined, compactLarge = true) {
  if (n == null || Number.isNaN(n)) return "n/a";
  if (compactLarge && Math.abs(n) >= 10000) return `$${compactFmt.format(n)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 })}`;
}
export function signed(n: number | null | undefined, formatter: (x: number) => string = (x) => compact(x)) {
  if (n == null) return "n/a";
  if (n === 0) return "0";
  return `${n > 0 ? "+" : "−"}${formatter(Math.abs(n))}`;
}
export function duration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const monthShort = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fullFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** "2026-09" -> "Sep 2026" */
export const monthLabel = (ym: string) => monthFmt.format(new Date(`${ym.slice(0, 7)}-01T00:00:00Z`));
/** "2026-09" -> "Sep" */
export const monthShortLabel = (ym: string) => monthShort.format(new Date(`${ym.slice(0, 7)}-01T00:00:00Z`));
/** "2026-09-14" -> "Sep 14" */
export const dayLabel = (d: string) => dayFmt.format(new Date(`${d.slice(0, 10)}T00:00:00Z`));
export const dateLabel = (d: string | Date) => fullFmt.format(typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d) : d);
export const dateTimeLabel = (d: string | Date) => dateTimeFmt.format(typeof d === "string" ? new Date(d) : d);
export function timeAgo(d: string | Date) {
  const t = (typeof d === "string" ? new Date(d) : d).getTime();
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return dateLabel(new Date(t));
}
export function truncateMiddle(s: string, max = 60) {
  if (s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return `${s.slice(0, half)}…${s.slice(-half)}`;
}
/** Strip protocol for display. */
export const displayUrl = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");
