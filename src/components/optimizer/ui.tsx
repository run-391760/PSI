import { Ban, CheckCircle2, CircleAlert } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { EvidenceSource, PublishStatus, Severity, Status } from "@/lib/optimizer/types";

/** Small presentational helpers shared by optimizer pages (server-safe). */

export const tone10 = (v: number | null | undefined): Tone => (v == null ? "neutral" : v >= 8 ? "good" : v >= 6 ? "warning" : v >= 4 ? "serious" : "critical");
export const color10 = (v: number | null | undefined) => (v == null ? "var(--border-strong)" : v >= 8 ? "var(--good)" : v >= 6 ? "var(--warning)" : v >= 4 ? "var(--serious)" : "var(--critical)");
export const fmt10 = (v: number | null | undefined) => (v == null ? "n/a" : v.toFixed(1));

export const STATUS_TEXT: Record<PublishStatus, string> = { ready: "Ready to publish", "needs-improvement": "Needs improvement", blocked: "Blocked" };

export function PublishBadge({ status, className }: { status: PublishStatus; className?: string }) {
  const t: Tone = status === "ready" ? "good" : status === "blocked" ? "critical" : "warning";
  const Icon = status === "ready" ? CheckCircle2 : status === "blocked" ? Ban : CircleAlert;
  return (
    <Badge tone={t} className={className}>
      <Icon className="h-3 w-3" />
      {STATUS_TEXT[status]}
    </Badge>
  );
}

const SEV: Record<Severity, { tone: Tone; label: string }> = { critical: { tone: "critical", label: "Critical" }, high: { tone: "serious", label: "High" }, medium: { tone: "warning", label: "Medium" }, low: { tone: "neutral", label: "Low" } };
export function SeverityBadge({ severity }: { severity: Severity | null }) {
  if (!severity) return null;
  return <Badge tone={SEV[severity].tone}>{SEV[severity].label}</Badge>;
}

const STATUS: Record<Status, { tone: Tone; label: string }> = { pass: { tone: "good", label: "Passed" }, warn: { tone: "warning", label: "Improve" }, fail: { tone: "critical", label: "Fix" }, na: { tone: "neutral", label: "Not run" } };
export function StatusPill({ status }: { status: Status }) {
  return <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>;
}

export const PRIORITY_TONE: Record<string, Tone> = { critical: "critical", high: "serious", medium: "warning" };

const SOURCE_LABEL: Record<EvidenceSource, string> = { content: "Draft", serp: "Live SERP", competitors: "Competitor pages", autocomplete: "Google Autocomplete", ai: "Claude", "live-url": "Live URL" };
export function SourceTags({ sources }: { sources: EvidenceSource[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {sources.map((s) => (
        <span key={s} className="rounded border border-border px-1 text-[10.5px] text-text-3">
          {SOURCE_LABEL[s]}
        </span>
      ))}
    </span>
  );
}

/** Horizontal 0–10 bar with the value. */
export function Bar10({ value, className }: { value: number | null; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3" role="meter" aria-valuenow={value ?? 0} aria-valuemin={0} aria-valuemax={10}>
        <div className="h-full rounded-full" style={{ width: `${(value ?? 0) * 10}%`, background: color10(value) }} />
      </div>
      <span className="w-8 text-right text-[12.5px] font-semibold tabular-nums text-text">{fmt10(value)}</span>
    </div>
  );
}
