import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export type Severity = "info" | "success" | "warning" | "critical";

export const SEVERITY_META: Record<Severity, { label: string; tone: "info" | "good" | "warning" | "critical"; icon: typeof Info; iconCls: string; bg: string }> = {
  critical: { label: "Critical", tone: "critical", icon: OctagonAlert, iconCls: "text-critical-ink", bg: "bg-critical-soft" },
  warning: { label: "Warning", tone: "warning", icon: AlertTriangle, iconCls: "text-warning-ink", bg: "bg-warning-soft" },
  success: { label: "Success", tone: "good", icon: CheckCircle2, iconCls: "text-good-ink", bg: "bg-good-soft" },
  info: { label: "Info", tone: "info", icon: Info, iconCls: "text-link", bg: "bg-info-soft" },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const m = SEVERITY_META[severity] ?? SEVERITY_META.info;
  const Icon = m.icon;
  return (
    <Badge tone={m.tone}>
      <Icon className="h-3 w-3" /> {m.label}
    </Badge>
  );
}

export function SeverityIcon({ severity, className }: { severity: Severity; className?: string }) {
  const m = SEVERITY_META[severity] ?? SEVERITY_META.info;
  const Icon = m.icon;
  return (
    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", m.bg, className)} aria-label={m.label} title={m.label}>
      <Icon className={cn("h-4 w-4", m.iconCls)} />
    </span>
  );
}
