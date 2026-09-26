import { MARKER_INFO, POTENTIAL_MIN, TOXIC_MIN, type AuditLevel } from "@/lib/backlinks/types";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

export const toxicTone = (score: number) => (score >= TOXIC_MIN ? "critical" : score >= POTENTIAL_MIN ? "warning" : "good");
export const toxicLabel = (score: number) => (score >= TOXIC_MIN ? "Toxic" : score >= POTENTIAL_MIN ? "Potentially toxic" : "Non-toxic");
export const LEVEL_META: Record<AuditLevel, { label: string; color: string; ink: string }> = {
  low: { label: "Low", color: "var(--good)", ink: "text-good-ink" },
  medium: { label: "Medium", color: "var(--warning)", ink: "text-warning-ink" },
  high: { label: "High", color: "var(--critical)", ink: "text-critical-ink" },
};

/** Toxicity score (0–100) with its class, server-safe. */
export function ToxicityScore({ score }: { score: number }) {
  const tone = toxicTone(score);
  return (
    <Tooltip content={`${toxicLabel(score)} (${score}/100). Toxic ≥ ${TOXIC_MIN}, potentially toxic ${POTENTIAL_MIN}–${TOXIC_MIN - 1}.`}>
      <span className="inline-flex items-center gap-2">
        <span
          className={cn(
            "tabular inline-flex h-5 min-w-8 items-center justify-center rounded px-1 text-[12px] font-semibold",
            tone === "critical" ? "bg-critical-soft text-critical-ink" : tone === "warning" ? "bg-warning-soft text-warning-ink" : "bg-good-soft text-good-ink",
          )}
        >
          {score}
        </span>
        <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-surface-3 sm:block" aria-hidden>
          <span className="block h-full rounded-full" style={{ width: `${score}%`, background: tone === "critical" ? "var(--critical)" : tone === "warning" ? "var(--warning)" : "var(--good)" }} />
        </span>
      </span>
    </Tooltip>
  );
}

/** Toxic markers as chips; each explains itself in a tooltip. */
export function MarkerChips({ markers, max = 3 }: { markers: string[]; max?: number }) {
  if (!markers.length) return <span className="text-[12px] text-text-3">None</span>;
  const shown = markers.slice(0, max);
  const rest = markers.slice(max);
  return (
    <span className="inline-flex max-w-[320px] flex-wrap gap-1">
      {shown.map((m) => (
        <Tooltip key={m} content={MARKER_INFO[m] ?? m}>
          <span className="inline-flex h-5 cursor-help items-center rounded border border-border bg-surface-2 px-1.5 text-[11px] whitespace-nowrap text-text-2">{m}</span>
        </Tooltip>
      ))}
      {rest.length > 0 && (
        <Tooltip content={rest.map((m) => `${m}: ${MARKER_INFO[m] ?? ""}`).join(" · ")}>
          <span className="inline-flex h-5 cursor-help items-center rounded bg-surface-3 px-1.5 text-[11px] text-text-2">+{rest.length}</span>
        </Tooltip>
      )}
    </span>
  );
}
