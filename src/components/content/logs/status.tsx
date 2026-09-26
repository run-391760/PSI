import { Badge, type Tone } from "@/components/ui/badge";

/** Server-safe helpers shared by the log dashboard and its client tables. */
export function statusTone(code: number): Tone {
  return code >= 500 ? "critical" : code >= 400 ? "serious" : code >= 300 ? "warning" : "good";
}
export function StatusBadge({ code }: { code: number }) {
  return <Badge tone={statusTone(code)}>{code}</Badge>;
}
/** Hits per day as a readable crawl frequency. */
export function frequency(hits: number, days: number) {
  if (!days || !hits) return "–";
  const perDay = hits / days;
  if (perDay >= 1) return `${perDay >= 10 ? Math.round(perDay) : perDay.toFixed(1)}× / day`;
  return `every ${Math.round(1 / perDay)} days`;
}
