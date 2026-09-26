"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { JobStatusDto } from "@/lib/backlinks/types";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Callout, Spinner } from "@/components/ui/feedback";

/**
 * Polls /api/backlinks/jobs/<id> every 1.5s while the job is queued or running, then refreshes the
 * page so server components pick up the results.
 */
export function JobProgress({ jobId, title, initial, className, compact }: { jobId: string; title: string; initial?: Partial<JobStatusDto>; className?: string; compact?: boolean }) {
  const router = useRouter();
  const [job, setJob] = useState<Partial<JobStatusDto>>(initial ?? { status: "queued" });
  const [error, setError] = useState<string | null>(null);
  const refreshed = useRef(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch(`/api/backlinks/jobs/${jobId}`, { cache: "no-store" });
        const body = await res.json();
        if (stop) return;
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        setJob(body);
        if (body.status === "queued" || body.status === "running") timer = setTimeout(tick, 1500);
        else if (!refreshed.current) {
          refreshed.current = true;
          router.refresh();
        }
      } catch (e) {
        if (stop) return;
        setError(e instanceof Error ? e.message : String(e));
        timer = setTimeout(tick, 4000);
      }
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [jobId, router]);

  if (job.status === "failed")
    return (
      <Callout tone="critical" title={`${title} failed`} className={className}>
        {job.error || "The job stopped unexpectedly. Try running it again."}
      </Callout>
    );
  if (job.status === "done" || job.status === "cancelled") return null;
  const pct = job.total ? Math.round(((job.progress ?? 0) / job.total) * 100) : null;
  const body = (
    <div className="flex items-center gap-3">
      <Spinner />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 text-[13px]">
          <span className="font-medium text-text">{title}</span>
          <span className="tabular text-text-3">{job.status === "queued" ? "Queued" : pct != null ? `${pct}%` : "Running"}</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div className={cn("h-full rounded-full bg-brand transition-all", pct == null && "w-1/3 animate-pulse")} style={pct != null ? { width: `${Math.max(4, pct)}%` } : undefined} />
        </div>
        <div className="mt-1 truncate text-[12px] text-text-3">{error ? `Reconnecting… (${error})` : job.message || (job.status === "queued" ? "Waiting for a worker…" : "Working…")}</div>
      </div>
    </div>
  );
  if (compact) return <div className={className}>{body}</div>;
  return <Card className={cn("px-4 py-3", className)}>{body}</Card>;
}
