import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { InfoTip } from "./tooltip";

/** Stat tile: label · value · optional delta (signed, vs a named period) · optional sub-line/sparkline. */
export function Metric({
  label,
  value,
  delta,
  deltaLabel,
  upIsGood = true,
  sub,
  href,
  info,
  size = "md",
  className,
  children,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Percent change; sign decides the arrow. */
  delta?: number | null;
  deltaLabel?: string;
  upIsGood?: boolean;
  sub?: ReactNode;
  href?: string;
  info?: string;
  size?: "sm" | "md" | "lg" | "hero";
  className?: string;
  children?: ReactNode;
}) {
  const valueCls = { sm: "text-[17px]", md: "text-[22px]", lg: "text-[28px]", hero: "text-[40px] leading-none" }[size];
  const good = delta == null ? null : delta === 0 ? null : delta > 0 === upIsGood;
  const content = (
    <span className={cn("font-semibold tracking-tight text-text", href && "text-link hover:underline", valueCls)}>{value}</span>
  );
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-1 text-[12.5px] text-text-2">
        <span className="truncate">{label}</span>
        {info && <InfoTip text={info} />}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {href ? <Link href={href}>{content}</Link> : content}
        {delta != null && (
          <span className={cn("inline-flex items-center text-[12px] font-medium", good === null ? "text-text-3" : good ? "text-good-ink" : "text-critical-ink")}>
            {delta > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : delta < 0 ? <ArrowDownRight className="h-3.5 w-3.5" /> : null}
            {delta > 0 ? "+" : ""}
            {delta.toFixed(Math.abs(delta) < 10 ? 1 : 0)}%{deltaLabel && <span className="ml-1 font-normal text-text-3">{deltaLabel}</span>}
          </span>
        )}
      </div>
      {sub && <div className="mt-0.5 text-[12px] text-text-3">{sub}</div>}
      {children}
    </div>
  );
}

/** A row of metrics separated by hairlines (Semrush-style summary strip). */
export function MetricStrip({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid divide-y divide-border sm:grid-flow-col sm:auto-cols-fr sm:divide-x sm:divide-y-0 [&>*]:px-4 [&>*]:py-3", className)}>{children}</div>;
}
