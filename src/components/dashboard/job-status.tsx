import { CircleCheck, CircleDashed, CircleX, Ban } from "lucide-react";
import { JOB_STATUS, jobPercent, type JobListRow } from "@/lib/reports/kinds";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/feedback";

/** Job status badge with icon (label always present, color only reinforces it). */
export function JobStatusBadge({ status, className }: { status: JobListRow["status"]; className?: string }) {
  const s = JOB_STATUS[status] ?? { label: status, tone: "neutral" as const };
  const icon =
    status === "running" ? (
      <Spinner className="h-3 w-3 border-[1.5px] border-current border-r-transparent" />
    ) : status === "done" ? (
      <CircleCheck className="h-3 w-3" />
    ) : status === "failed" ? (
      <CircleX className="h-3 w-3" />
    ) : status === "cancelled" ? (
      <Ban className="h-3 w-3" />
    ) : (
      <CircleDashed className="h-3 w-3" />
    );
  return (
    <Badge tone={s.tone} className={className}>
      {icon}
      {s.label}
    </Badge>
  );
}

/** Thin progress bar with percentage for a job. */
export function JobProgress({ job, className }: { job: Pick<JobListRow, "progress" | "total" | "status">; className?: string }) {
  const p = jobPercent(job);
  const indeterminate = job.status === "running" && job.total === 0;
  const color = job.status === "failed" ? "var(--critical)" : job.status === "done" ? "var(--good)" : job.status === "cancelled" ? "var(--text-3)" : "var(--brand)";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded-full transition-[width] duration-500", indeterminate && "animate-pulse")} style={{ width: `${indeterminate ? 35 : p}%`, background: color }} />
      </div>
      <span className="tabular w-9 shrink-0 text-right text-[11.5px] text-text-3">{job.status === "queued" || indeterminate ? "–" : `${p}%`}</span>
    </div>
  );
}
