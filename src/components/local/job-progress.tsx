"use client";

import { Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";

type JobState = { status: "queued" | "running" | "done" | "failed" | "cancelled"; progress: number; total: number; message: string | null; error: string | null };

/**
 * Polls a job endpoint (`${endpoint}/${jobId}`) every ~1.2s while it is queued/running and refreshes
 * the page when it finishes. Supports cancel via DELETE on the same URL.
 */
export function JobProgress({ jobId, endpoint, title, className, cancellable = true }: { jobId: string; endpoint: string; title: string; className?: string; cancellable?: boolean }) {
  const router = useRouter();
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const refreshed = useRef(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await fetch(`${endpoint}/${jobId}`, { cache: "no-store" });
        const data = await res.json();
        if (stop) return;
        if (!res.ok) {
          setError(data.error ?? "Could not load job progress.");
          return;
        }
        setJob(data);
        if (data.status === "queued" || data.status === "running") timer = setTimeout(tick, 1200);
        else if (!refreshed.current) {
          refreshed.current = true;
          router.refresh();
        }
      } catch {
        if (!stop) timer = setTimeout(tick, 2500);
      }
    };
    tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, endpoint, router]);

  const cancel = async () => {
    setCancelling(true);
    await fetch(`${endpoint}/${jobId}`, { method: "DELETE" }).catch(() => null);
  };

  if (error) return <Callout tone="critical" className={className}>{error}</Callout>;
  if (job?.status === "failed") return <Callout tone="critical" className={className} title={`${title} failed`}>{job.error ?? "Unknown error."}</Callout>;
  const pct = job && job.total > 0 ? Math.min(100, Math.round((job.progress / job.total) * 100)) : null;
  return (
    <Card className={cn("px-4 py-3.5", className)}>
      <div className="flex items-center gap-3" role="status" aria-live="polite">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-[13.5px] font-semibold text-text">{title}</span>
            <span className="tabular text-[12px] text-text-3">
              {job?.status === "queued" || !job ? "Queued…" : pct != null ? `${job.progress.toLocaleString()} / ${job.total.toLocaleString()} · ${pct}%` : "Working…"}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            <div className={cn("h-full rounded-full bg-brand transition-[width] duration-500", pct == null && "w-1/3 animate-pulse")} style={pct != null ? { width: `${Math.max(3, pct)}%` } : undefined} />
          </div>
          {job?.message && <div className="mt-1 truncate text-[12px] text-text-3">{job.message}</div>}
        </div>
        {cancellable && (
          <Button size="sm" variant="ghost" onClick={cancel} loading={cancelling} aria-label="Cancel job">
            <X className="h-3.5 w-3.5" /> Cancel
          </Button>
        )}
      </div>
    </Card>
  );
}
