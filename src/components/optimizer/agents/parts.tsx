import { CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from "lucide-react";
import type { Tone } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Confidence, ItemKind, ItemValue, Outcome, QuoteCheck, StageStatus } from "@/lib/optimizer/agents/types";
import { featureById } from "@/lib/optimizer/features";
import type { PublishStatus } from "@/lib/optimizer/types";
import { fmt10, STATUS_TEXT } from "../ui";

/** Presentational helpers of the agent audit (server-safe). */

export function StageIcon({ status, className }: { status: StageStatus; className?: string }) {
  const c = cn("h-4 w-4", className);
  if (status === "done") return <CheckCircle2 className={cn(c, "text-good-ink")} aria-label="Done" />;
  if (status === "running") return <Loader2 className={cn(c, "animate-spin text-brand-ink")} aria-label="Running" />;
  if (status === "failed") return <XCircle className={cn(c, "text-critical-ink")} aria-label="Failed" />;
  if (status === "skipped") return <MinusCircle className={cn(c, "text-text-3")} aria-label="Skipped" />;
  return <Circle className={cn(c, "text-border-strong")} aria-label="Waiting" />;
}

export const CONFIDENCE_TONE: Record<Confidence, Tone> = { high: "good", medium: "warning", low: "critical", none: "neutral" };
export const confidenceText = (c: Confidence) => (c === "none" ? "n/a" : `${c} confidence`);

export const OUTCOME: Record<Outcome, { label: string; tone: Tone; help: string }> = {
  confirmed: { label: "Confirmed", tone: "good", help: "Analyst and reviewer agree with the engine." },
  adjusted: { label: "Adjusted", tone: "brand", help: "Analyst and reviewer agreed on a different score with verified quotes (max ±0.25)." },
  rejected: { label: "Rejected", tone: "warning", help: "The reviewer rejected the analyst's claim: engine score kept." },
  split: { label: "Disagreed", tone: "warning", help: "Analyst and reviewer disagreed: engine score kept." },
  unresolved: { label: "Unresolved", tone: "warning", help: "Same direction, different size and no tie-break result: engine score kept." },
  unsupported: { label: "No evidence", tone: "warning", help: "A change was proposed without any quote found in the draft: engine score kept." },
  dropped: { label: "Dropped", tone: "critical", help: "The analyst quoted text that is not in the draft: claim dropped." },
  "no-claim": { label: "Not assessed", tone: "neutral", help: "The analyst did not assess this check: engine score kept." },
  unreviewed: { label: "Unreviewed", tone: "neutral", help: "An agent stage failed: engine score kept." },
  "not-measured": { label: "Not measured", tone: "neutral", help: "The engine could not measure this check, so there is nothing to verify." },
};

/** An item value as text: score /10, count, publish status or the recommended check. */
export function valueText(kind: ItemKind, v: ItemValue): string {
  if (v == null) return "n/a";
  if (kind === "score") return fmt10(Number(v));
  if (kind === "count") return String(v);
  if (kind === "status") return STATUS_TEXT[v as PublishStatus] ?? String(v);
  return featureById(String(v))?.name ?? String(v);
}

export function deltaText(kind: ItemKind, delta: number | null, changed: boolean): string {
  if (kind === "score") return delta == null ? "n/a" : delta === 0 ? "±0" : `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}`;
  if (kind === "count") return delta == null ? "n/a" : delta === 0 ? "±0" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)}`;
  return changed ? "changed" : "same";
}

export const pct = (v: number | null) => (v == null ? "n/a" : `${Math.round(v * 100)}%`);
export const score01 = (v: number | null) => (v == null ? "n/a" : `${Math.round(v * 100)}%`);

/** Quotes with their verification result. */
export function Quotes({ quotes }: { quotes: QuoteCheck[] }) {
  if (!quotes.length) return null;
  return (
    <ul className="mt-1 space-y-1">
      {quotes.map((q, i) => (
        <li key={i} className="flex items-start gap-1.5 text-[12px]">
          {q.result === "verified" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good-ink" aria-label="Found in the draft" /> : q.result === "fabricated" ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-critical-ink" aria-label="Not in the draft" /> : <MinusCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-3" aria-label="Too short to verify" />}
          <span className={cn("min-w-0 break-words", q.result === "fabricated" ? "text-critical-ink line-through decoration-1" : "text-text-2")}>“{q.text}”</span>
        </li>
      ))}
    </ul>
  );
}
