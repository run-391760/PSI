"use client";

import { RefreshCw, Radar } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fetchNowAction } from "@/app/(app)/cx/listening/actions";
import { runDetectionAction } from "@/app/(app)/cx/crisis/actions";
import { Button } from "@/components/ui/button";
import { Bar } from "@/components/ui/progress";

type JobState = { status: "queued" | "running" | "done" | "failed" | "cancelled"; progress: number; total: number; message: string | null; error: string | null };

/** "Fetch now" / "Run detection" button with inline job progress; refreshes the page when done. */
export function JobButton({ brandId, kind, initialJobId, variant = "primary" }: { brandId: string; kind: "fetch" | "detect"; initialJobId?: string | null; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(initialJobId ?? null);
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const finished = useRef(false);

  useEffect(() => {
    if (!jobId) return;
    finished.current = false;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/cx/listening/jobs/${jobId}`, { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as JobState;
        if (!alive) return;
        setJob(next);
        if (!["queued", "running"].includes(next.status) && !finished.current) {
          finished.current = true;
          if (next.status === "failed") setError(next.error ?? "The job failed.");
          setJobId(null);
          router.refresh();
        }
      } catch {
        /* retry on next tick */
      }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [jobId, router]);

  const start = async () => {
    setStarting(true);
    setError(null);
    const res = kind === "fetch" ? await fetchNowAction(brandId) : await runDetectionAction(brandId);
    setStarting(false);
    if (res.ok) {
      setJob({ status: "queued", progress: 0, total: 0, message: null, error: null });
      setJobId(res.data.jobId);
    } else setError(res.error);
  };

  const busy = !!jobId;
  const pct = job?.total ? Math.round((job.progress / job.total) * 100) : 0;
  const Icon = kind === "fetch" ? RefreshCw : Radar;
  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant={variant} onClick={start} loading={starting || busy} disabled={starting || busy}>
        {!starting && !busy && <Icon className="h-4 w-4" />}
        {busy ? (job?.status === "queued" ? "Queued…" : `${kind === "fetch" ? "Fetching" : "Detecting"} ${pct ? `${pct}%` : "…"}`) : kind === "fetch" ? "Fetch now" : "Run detection"}
      </Button>
      {busy && (
        <div className="w-48" role="status" aria-live="polite">
          <Bar value={job?.status === "queued" ? 2 : Math.max(4, pct)} className="h-1.5" color="var(--brand)" />
          <div className="mt-0.5 truncate text-right text-[11.5px] text-text-3">{job?.message ?? "Starting"}</div>
        </div>
      )}
      {error && <div className="max-w-64 text-right text-[12px] text-critical-ink">{error}</div>}
    </div>
  );
}
