"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Bar } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/feedback";

type JobState = { status: "queued" | "running" | "done" | "failed" | "cancelled"; progress: number; total: number; message: string | null; error: string | null };

/** Polls a content job every 1.5s and refreshes the page when it finishes. */
export function JobProgress({ jobId, initial, title = "Collecting ideas", unit = "pages" }: { jobId: string; initial: JobState; title?: string; unit?: string }) {
  const router = useRouter();
  const [job, setJob] = useState<JobState>(initial);
  const [cancelling, setCancelling] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/content/jobs/${jobId}`, { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as JobState;
        if (!alive) return;
        setJob(next);
        if (!["queued", "running"].includes(next.status) && !done.current) {
          done.current = true;
          router.refresh();
        }
      } catch {
        /* transient network error: try again on the next tick */
      }
    };
    const t = setInterval(tick, 1500);
    tick();
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [jobId, router]);

  const cancel = async () => {
    setCancelling(true);
    await fetch(`/api/content/jobs/${jobId}`, { method: "DELETE" }).catch(() => null);
    router.refresh();
  };

  const pct = job.total ? Math.round((job.progress / job.total) * 100) : 0;
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3.5 shadow-card" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <Spinner />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-text">
            {job.status === "queued" ? "Waiting for a worker…" : title}
            {job.total > 0 && (
              <span className="ml-2 font-normal text-text-2">
                {job.progress} of {job.total} {unit} · {pct}%
              </span>
            )}
          </div>
          <div className="truncate text-[12.5px] text-text-3">{job.message ?? "Starting"}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={cancel} loading={cancelling}>
          Cancel
        </Button>
      </div>
      <Bar value={job.status === "queued" ? 2 : Math.max(4, pct)} className="mt-3 h-2" color="var(--brand)" />
    </div>
  );
}
