import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Wrench } from "lucide-react";
import Link from "next/link";
import { timeAgo } from "@/lib/format";
import type { ToolSummary } from "@/lib/projects/summary-types";
import { cn } from "@/lib/utils";
import { toolByHref } from "@/components/shell/nav";
import { Sparkline } from "@/components/seo/badges";
import { Spinner } from "@/components/ui/feedback";

/** Nav metadata (icon + description) for a widget, matched by its href path. */
export function widgetTool(s: Pick<ToolSummary, "href" | "label">) {
  const t = toolByHref(s.href.split("?")[0]);
  return { icon: t?.icon ?? Wrench, description: t?.description ?? "", label: s.label || t?.label || "Tool" };
}

/** Signed delta with an arrow. Units are tool-defined, so only the magnitude is printed. */
export function WidgetDelta({ delta, upIsGood = true, className }: { delta: number | null | undefined; upIsGood?: boolean; className?: string }) {
  if (delta == null || Number.isNaN(delta)) return null;
  if (delta === 0) return <span className={cn("text-[12px] text-text-3", className)}>±0</span>;
  const good = delta > 0 === upIsGood;
  const v = Math.abs(delta);
  return (
    <span className={cn("tabular inline-flex items-center text-[12px] font-medium", good ? "text-good-ink" : "text-critical-ink", className)}>
      {delta > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
      {v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(v % 1 ? 1 : 0)}
    </span>
  );
}

/**
 * One project tool widget (server-safe). Renders each ToolSummary state: ready (headline + delta,
 * stats, sparkline), empty (CTA), running (spinner) and error (message).
 */
export function ToolWidget({ summary: s, className }: { summary: ToolSummary; className?: string }) {
  const meta = widgetTool(s);
  const Icon = meta.icon;
  const broken = s.href === "#" || !s.href;
  return (
    <div className={cn("flex flex-col rounded-lg border sm:min-h-[132px] border-border bg-surface p-3.5", s.state === "empty" && "border-dashed bg-surface-2", className)}>
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-ink">
          <Icon className="h-3.5 w-3.5" />
        </span>
        {broken ? (
          <span className="truncate text-[13px] font-semibold text-text">{meta.label}</span>
        ) : (
          <Link href={s.href} className="truncate text-[13px] font-semibold text-text hover:text-link">
            {meta.label}
          </Link>
        )}
        {s.state === "ready" && s.updatedAt && <span className="ml-auto shrink-0 text-[11px] text-text-3">{timeAgo(s.updatedAt)}</span>}
      </div>

      {s.state === "ready" && (
        <>
          <div className="mt-2.5 flex items-end justify-between gap-2">
            <div className="min-w-0">
              {s.headline && <div className="truncate text-[11.5px] text-text-3">{s.headline.label}</div>}
              <div className="flex flex-wrap items-baseline gap-x-1.5">
                <Link href={s.href} className="text-[22px] leading-tight font-semibold tracking-tight text-text hover:text-link">
                  {s.headline?.value ?? "Ready"}
                </Link>
                <WidgetDelta delta={s.headline?.delta} upIsGood={s.headline?.upIsGood} />
              </div>
            </div>
            {s.spark && s.spark.length > 1 && <Sparkline values={s.spark} width={76} height={28} />}
          </div>
          {s.stats && s.stats.length > 0 && (
            <dl className="mt-auto grid grid-cols-3 gap-2 border-t border-border pt-2 text-[11.5px]">
              {s.stats.slice(0, 3).map((st) => (
                <div key={st.label} className="min-w-0">
                  <dt className="truncate text-text-3">{st.label}</dt>
                  <dd className="tabular truncate font-medium text-text">{st.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {s.note && !s.stats?.length && <p className="mt-auto pt-2 text-[12px] text-text-3">{s.note}</p>}
        </>
      )}

      {s.state === "empty" && (
        <>
          <p className="mt-2 line-clamp-2 text-[12px] text-text-3">{s.note || meta.description}</p>
          <div className="mt-auto pt-2.5">
            <Link href={s.href} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-link hover:underline">
              {s.cta || "Set up"} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </>
      )}

      {s.state === "running" && (
        <div className="mt-3 flex flex-1 flex-col justify-center gap-1.5">
          <div className="flex items-center gap-2 text-[13px] font-medium text-text">
            <Spinner className="h-3.5 w-3.5" /> Running…
          </div>
          <p className="line-clamp-2 text-[12px] text-text-3">{s.note || "Results will appear here when the job finishes."}</p>
        </div>
      )}

      {s.state === "error" && (
        <div className="mt-2.5 flex flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-critical-ink">
            <AlertTriangle className="h-3.5 w-3.5" /> Could not load
          </div>
          <p className="line-clamp-3 text-[12px] break-words text-text-3">{s.note || "The tool reported an error."}</p>
        </div>
      )}
    </div>
  );
}

/** Compact one-line cell for the projects table. */
export function ToolCell({ summary: s }: { summary: ToolSummary | undefined }) {
  if (!s) return <span className="text-text-3">n/a</span>;
  if (s.state === "empty")
    return (
      <Link href={s.href} className="inline-flex items-center gap-0.5 text-[12.5px] text-link hover:underline" title={s.cta || "Set up"}>
        Set up
      </Link>
    );
  if (s.state === "running")
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-text-2">
        <Spinner className="h-3 w-3" /> Running
      </span>
    );
  if (s.state === "error")
    return (
      <span className="inline-flex items-center gap-1 text-[12.5px] text-critical-ink" title={s.note}>
        <AlertTriangle className="h-3.5 w-3.5" /> Error
      </span>
    );
  return (
    <Link href={s.href} className="group inline-flex flex-col items-end leading-tight" title={s.headline?.label}>
      <span className="inline-flex items-center gap-1">
        <span className="font-semibold text-text group-hover:text-link">{s.headline?.value ?? "Ready"}</span>
        <WidgetDelta delta={s.headline?.delta} upIsGood={s.headline?.upIsGood} />
      </span>
      {s.headline?.label && <span className="text-[11px] text-text-3">{s.headline.label}</span>}
    </Link>
  );
}
