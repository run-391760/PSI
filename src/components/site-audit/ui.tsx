import { AlertTriangle, CheckCircle2, Info, OctagonAlert, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { Severity } from "@/lib/site-audit/types";
import { cn } from "@/lib/utils";
import { Badge, type Tone } from "@/components/ui/badge";

/** Server-safe presentational helpers shared by the Site Audit views. */

export const SEV_TONE: Record<Severity, Tone> = { error: "critical", warning: "warning", notice: "info" };
export const SEV_LABEL: Record<Severity, string> = { error: "Error", warning: "Warning", notice: "Notice" };
export const SEV_PLURAL: Record<Severity, string> = { error: "Errors", warning: "Warnings", notice: "Notices" };
export const SEV_COLOR: Record<Severity, string> = { error: "var(--critical)", warning: "var(--warning)", notice: "var(--link)" };

export function SeverityIcon({ severity, className }: { severity: Severity; className?: string }) {
  const cls = cn("h-4 w-4 shrink-0", className);
  if (severity === "error") return <OctagonAlert className={cn(cls, "text-critical-ink")} aria-label="Error" />;
  if (severity === "warning") return <AlertTriangle className={cn(cls, "text-warning-ink")} aria-label="Warning" />;
  return <Info className={cn(cls, "text-link")} aria-label="Notice" />;
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge tone={SEV_TONE[severity]}>{SEV_LABEL[severity]}</Badge>;
}

/** HTTP status chip: 2xx good, 3xx info, 4xx/5xx critical, 0 = failed, null = blocked. */
export function HttpStatus({ status, blocked }: { status: number | null | undefined; blocked?: boolean }) {
  if (status == null) return <Badge tone="neutral">{blocked ? "Blocked" : "n/a"}</Badge>;
  if (status === 0) return <Badge tone="critical">Failed</Badge>;
  const tone: Tone = status >= 500 ? "critical" : status >= 400 ? "critical" : status >= 300 ? "info" : "good";
  return <Badge tone={tone}>{status}</Badge>;
}

/** Checklist row. `ok`: true = pass, false = error, null = informational; `state` overrides with a severity. */
export function PassFail({ ok, children, detail, state }: { ok: boolean | null; children: ReactNode; detail?: ReactNode; state?: "ok" | Severity | "unknown" }) {
  const s = state ?? (ok === null ? "unknown" : ok ? "ok" : "error");
  const icon =
    s === "ok" ? (
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good-ink" aria-label="Passed" />
    ) : s === "error" ? (
      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-critical-ink" aria-label="Error" />
    ) : s === "warning" ? (
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-ink" aria-label="Warning" />
    ) : s === "notice" ? (
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-link" aria-label="Notice" />
    ) : (
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-text-3" aria-label="Not checked" />
    );
  return (
    <li className="flex items-start gap-2.5 py-2">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-text">{children}</div>
        {detail && <div className="mt-0.5 text-[12px] break-words text-text-3">{detail}</div>}
      </div>
    </li>
  );
}

/** Unit for an issue count: pages, links or site-wide. */
export function countUnit(scope: "page" | "link" | "site", n: number) {
  if (scope === "site") return n === 1 ? "site-wide" : `${n} findings`;
  if (scope === "link") return `${n.toLocaleString()} link${n === 1 ? "" : "s"}`;
  return `${n.toLocaleString()} page${n === 1 ? "" : "s"}`;
}

export function scoreTone(v: number | null | undefined): Tone {
  if (v == null) return "neutral";
  return v >= 80 ? "good" : v >= 60 ? "warning" : v >= 40 ? "serious" : "critical";
}
export function scoreColor(v: number | null | undefined) {
  if (v == null) return "var(--surface-3)";
  return v >= 80 ? "var(--good)" : v >= 60 ? "var(--warning)" : v >= 40 ? "var(--serious)" : "var(--critical)";
}

/** Signed count delta with color: for issue counts, fewer is better. */
export function CountDelta({ delta, upIsGood = false, suffix = "", showZero }: { delta: number | null | undefined; upIsGood?: boolean; suffix?: string; showZero?: boolean }) {
  if (delta == null) return null;
  if (delta === 0) return showZero ? <span className="text-[12px] whitespace-nowrap text-text-3">no change</span> : null;
  const good = delta > 0 === upIsGood;
  return (
    <span className={cn("tabular text-[12px] font-medium", good ? "text-good-ink" : "text-critical-ink")}>
      {delta > 0 ? "+" : "−"}
      {Math.abs(delta).toLocaleString()}
      {suffix}
    </span>
  );
}

export function KeyValue({ items, className }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[minmax(110px,38%)_1fr] gap-x-3 gap-y-1.5 text-[12.5px]", className)}>
      {items.map((it, i) => (
        <div key={i} className="contents">
          <dt className="text-text-3">{it.label}</dt>
          <dd className="min-w-0 break-words text-text">{it.value ?? <span className="text-text-3">n/a</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export const fmtMs = (ms: number | null | undefined) => (ms == null ? "n/a" : ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s` : `${Math.round(ms)} ms`);
export const fmtBytes = (b: number | null | undefined) => (b == null ? "n/a" : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
export const shortUrl = (url: string) => url.replace(/^https?:\/\//, "");
export function pathOf(url: string) {
  try {
    const u = new URL(url);
    return u.pathname + u.search || "/";
  } catch {
    return url;
  }
}
