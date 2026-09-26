import { compact, dayLabel, money, monthLabel, monthShortLabel } from "@/lib/format";

/** Named formatters so server components can pick a format without passing functions. */
export type ValueFormat = "compact" | "number" | "percent" | "money" | "position" | "raw";
export type AxisFormat = "month" | "monthShort" | "day" | "raw";

export function formatValue(v: unknown, f: ValueFormat = "compact") {
  if (v == null || v === "") return "n/a";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  switch (f) {
    case "percent":
      return `${n.toFixed(n < 10 && n % 1 ? 1 : 0)}%`;
    case "money":
      return money(n);
    case "number":
      return n.toLocaleString("en-US");
    case "position":
      return `#${Math.round(n)}`;
    case "raw":
      return String(v);
    default:
      return compact(n);
  }
}
export function formatAxis(v: unknown, f: AxisFormat = "raw") {
  const s = String(v);
  if (f === "month" && /^\d{4}-\d{2}/.test(s)) return monthLabel(s);
  if (f === "monthShort" && /^\d{4}-\d{2}/.test(s)) return monthShortLabel(s);
  if (f === "day" && /^\d{4}-\d{2}-\d{2}/.test(s)) return dayLabel(s);
  return s;
}
