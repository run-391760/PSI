"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { cancelCheckAction, runCheckAction } from "@/app/(app)/position-tracking/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { Bar } from "@/components/ui/progress";

type JobState = { id: string; status: string; progress: number; total: number; message: string | null; error?: string | null };

/** Live progress of the active rank check; refreshes the page when it finishes. */
export function CheckProgress({ projectId, job }: { projectId: string; job: JobState }) {
  const router = useRouter();
  const [state, setState] = useState<JobState>(job);
  const [pending, start] = useTransition();
  const done = useRef(false);
  useEffect(() => setState(job), [job]);
  useEffect(() => {
    done.current = false;
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/position-tracking/jobs/${job.id}`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as JobState;
          if (!alive) return;
          setState(next);
          if (!["queued", "running"].includes(next.status)) {
            if (!done.current) {
              done.current = true;
              router.refresh();
            }
            return;
          }
        }
      } catch {}
      if (alive) timer = setTimeout(poll, 1500);
    };
    timer = setTimeout(poll, 800);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [job.id, router]);

  if (state.status === "failed")
    return (
      <div role="alert" className="mb-4 rounded-lg border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-text-2">
        <span className="font-semibold text-text">The rank check failed.</span> {state.error ?? "Please try again."}
      </div>
    );
  if (!["queued", "running"].includes(state.status)) return null;
  const pct = state.total ? Math.round((state.progress / state.total) * 100) : 0;
  return (
    <div className="mb-4 rounded-lg border border-link/25 bg-info-soft px-4 py-3" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <Spinner />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-text">{state.status === "queued" ? "Rank check queued…" : (state.message ?? "Checking rankings…")}</div>
          <div className="text-[12px] text-text-2">Reports update automatically when the check completes.</div>
        </div>
        <span className="tabular text-[12.5px] font-medium text-text-2">{pct}%</span>
        <Button size="sm" variant="ghost" loading={pending} onClick={() => start(async () => void (await cancelCheckAction(projectId, job.id), router.refresh()))}>
          Cancel
        </Button>
      </div>
      <Bar value={pct} className="mt-2.5 h-1.5" color="var(--link)" />
    </div>
  );
}

/** "Update now" — enqueues a check (or reuses the running one). */
export function UpdateNowButton({ projectId, disabled }: { projectId: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-[12px] text-critical-ink">{error}</span>}
      <Button
        variant="secondary"
        loading={pending}
        disabled={disabled}
        title={disabled ? "A check is already running" : "Check rankings now"}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await runCheckAction(projectId);
            if (!res.ok) setError(res.error);
            router.refresh();
          })
        }
      >
        {!pending && <RefreshCw className="h-3.5 w-3.5" />} Update now
      </Button>
    </span>
  );
}
