import { AlertTriangle, CheckCircle2, Info, OctagonAlert, SearchX } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-3 text-text-3">{icon ?? <SearchX className="h-5 w-5" />}</div>
      <h3 className="text-[15px] font-semibold text-text">{title}</h3>
      {description && <p className="mt-1 max-w-md text-[13px] text-text-2">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

type CalloutTone = "info" | "good" | "warning" | "critical";
const calloutStyles: Record<CalloutTone, { box: string; icon: ReactNode }> = {
  info: { box: "border-link/25 bg-info-soft", icon: <Info className="h-4 w-4 text-link" /> },
  good: { box: "border-good/30 bg-good-soft", icon: <CheckCircle2 className="h-4 w-4 text-good-ink" /> },
  warning: { box: "border-warning/40 bg-warning-soft", icon: <AlertTriangle className="h-4 w-4 text-warning-ink" /> },
  critical: { box: "border-critical/30 bg-critical-soft", icon: <OctagonAlert className="h-4 w-4 text-critical-ink" /> },
};
export function Callout({ tone = "info", title, children, className, action }: { tone?: CalloutTone; title?: ReactNode; children?: ReactNode; className?: string; action?: ReactNode }) {
  const s = calloutStyles[tone];
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px]", s.box, className)}>
      <span className="mt-0.5 shrink-0">{s.icon}</span>
      <div className="min-w-0 flex-1 text-text-2">
        {title && <div className="font-semibold text-text">{title}</div>}
        {children}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-md", className)} aria-hidden />;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand border-r-transparent", className)} aria-label="Loading" />;
}
