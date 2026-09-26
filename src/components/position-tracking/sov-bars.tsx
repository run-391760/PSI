import { pct } from "@/lib/format";
import { Bar } from "@/components/ui/progress";
import { domainColor } from "./ui";

/** Share-of-voice bars per domain (domain identity via its fixed swatch color). Server-safe. */
export function SovBars({ rows, max, limit }: { rows: { domain: string; index: number; sov: number | null }[]; max?: number; limit?: number }) {
  const sorted = [...rows].sort((a, b) => (b.sov ?? 0) - (a.sov ?? 0)).slice(0, limit ?? rows.length);
  const top = max ?? Math.max(1, ...sorted.map((r) => r.sov ?? 0));
  return (
    <ul className="space-y-2">
      {sorted.map((r) => (
        <li key={r.domain} className="grid grid-cols-[minmax(0,1fr)_minmax(70px,1fr)_52px] items-center gap-2.5 text-[12.5px]">
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: domainColor(r.index) }} aria-hidden />
            <span className={r.index === 0 ? "truncate font-medium text-text" : "truncate text-text-2"} title={r.domain}>
              {r.domain}
            </span>
          </span>
          <Bar value={r.sov ?? 0} max={top} color={domainColor(r.index)} />
          <span className="tabular text-right font-medium text-text">{r.sov == null ? "n/a" : pct(r.sov, 1)}</span>
        </li>
      ))}
    </ul>
  );
}
