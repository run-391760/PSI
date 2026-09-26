"use client";

import { Gauge, RotateCw, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { remeasureCwv, startAudit, stopAudit } from "@/app/(app)/site-audit/actions";
import type { LiveProgress } from "@/lib/site-audit/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Callout, Spinner } from "@/components/ui/feedback";

type JobPoll = {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: number;
  total: number;
  message: string | null;
  error: string | null;
  startedAt: string | null;
  crawlStatus: string | null;
  live: Partial<LiveProgress> | null;
};

function usePoll(jobId: string | null, onFinish: (j: JobPoll) => void) {
  const [job, setJob] = useState<JobPoll | null>(null);
  const finished = useRef(false);
  useEffect(() => {
    if (!jobId) return;
    finished.current = false;
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/site-audit/jobs/${jobId}`, { cache: "no-store" });
        if (res.ok) {
          const j = (await res.json()) as JobPoll;
          if (!alive) return;
          setJob(j);
          // A stopped crawl keeps analyzing after the job is cancelled; wait until its row is final.
          const done = j.status === "done" || j.status === "failed" || (j.status === "cancelled" && j.crawlStatus !== "running");
          if (done && !finished.current) {
            finished.current = true;
            onFinish(j);
            return;
          }
        }
      } catch {
        /* transient network error: keep polling */
      }
      if (alive) timer = setTimeout(tick, 1500);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [jobId, onFinish]);
  return job;
}

const STEPS = ["robots.txt & sitemaps", "Crawl pages", "Site-wide checks", "Links & resources", "Core Web Vitals", "Analysis"];
function stepOf(phase: string | null | undefined, status: string | undefined) {
  if (!phase || status === "queued") return -1;
  if (/robots\.txt$|Reading/.test(phase) && !/HTTPS/.test(phase)) return 0;
  if (phase === "Crawling" || /^Crawled/.test(phase)) return 1;
  if (/HTTPS|canonical/.test(phase)) return 2;
  if (/images|external|slow/i.test(phase)) return 3;
  if (/Web Vitals/.test(phase)) return 4;
  return 5;
}

const elapsed = (from: string | null | undefined, now: number) => {
  if (!from || !now) return "0s";
  const s = Math.max(0, Math.round((now - new Date(from).getTime()) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};

/** Live crawl view: polls the job every 1.5 s, shows progress + a feed of crawled URLs, then refreshes the report. */
export function CrawlProgress({ projectId, jobId, limit, hasPrevious }: { projectId: string; jobId: string; limit: number; hasPrevious: boolean }) {
  const router = useRouter();
  const [stopping, startStop] = useTransition();
  const [stopRequested, setStopRequested] = useState(false);
  const [now, setNow] = useState(0);
  const onFinish = useRef(() => setTimeout(() => router.refresh(), 300)).current;
  const job = usePoll(jobId, onFinish);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    const first = setTimeout(() => setNow(Date.now()), 0);
    return () => {
      clearInterval(t);
      clearTimeout(first);
    };
  }, []);
  const live = job?.live ?? null;
  const crawled = live?.crawled ?? job?.progress ?? 0;
  const cap = live?.limit ?? limit;
  const discovered = live?.discovered ?? 0;
  const pct = Math.min(100, Math.round((crawled / Math.max(1, Math.min(cap, Math.max(discovered, crawled)))) * 100));
  const phase = job?.status === "queued" ? "Waiting for a crawler slot…" : (live?.phase ?? job?.message ?? "Starting…");
  const crawling = !live?.phase || live.phase === "Crawling";
  const secs = job?.startedAt && now ? Math.max(1, (now - new Date(job.startedAt).getTime()) / 1000) : 0;
  const rate = secs ? crawled / secs : 0;

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-good" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-text">{stopRequested ? "Stopping — analyzing the pages crawled so far…" : job?.status === "queued" ? "Crawl queued" : "Crawling your site"}</div>
          <div className="truncate text-[12.5px] text-text-3">{crawling && job?.status === "running" ? "Following internal links breadth-first from the start URL" : phase}</div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          loading={stopping}
          disabled={stopRequested || !job || job.status === "done"}
          onClick={() =>
            startStop(async () => {
              const res = await stopAudit(projectId, jobId);
              if (res.ok) setStopRequested(true);
            })
          }
          title="Stop crawling and keep the results for the pages crawled so far"
        >
          <Square className="h-3 w-3" /> Stop
        </Button>
      </div>
      <ol className="scroll-thin flex gap-1 overflow-x-auto border-b border-border px-4 py-2.5" aria-label="Audit phases">
        {STEPS.map((label, i) => {
          const cur = stepOf(live?.phase ?? job?.message, job?.status);
          const state = i < cur ? "done" : i === cur ? "active" : "todo";
          return (
            <li key={label} className="flex shrink-0 items-center gap-1.5 text-[12px]">
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10.5px] font-semibold",
                  state === "done" ? "bg-good-soft text-good-ink" : state === "active" ? "bg-brand text-white" : "bg-surface-3 text-text-3",
                )}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              <span className={cn(state === "active" ? "font-medium text-text" : state === "done" ? "text-text-2" : "text-text-3")}>{label}</span>
              {i < STEPS.length - 1 && <span className="mx-1.5 h-px w-5 bg-border-strong" aria-hidden />}
            </li>
          );
        })}
      </ol>
      <div className="grid gap-4 px-4 py-4 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[28px] leading-none font-semibold tracking-tight text-text tabular">
              {crawled.toLocaleString()}
              <span className="ml-1 text-[14px] font-normal text-text-3">/ {Math.min(cap, Math.max(discovered, crawled)).toLocaleString()} pages</span>
            </div>
            <span className="tabular text-[13px] text-text-2">{crawling ? `${pct}%` : <Spinner className="h-3.5 w-3.5" />}</span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={cn("h-full rounded-full bg-brand transition-[width] duration-700", !crawling && "animate-pulse")} style={{ width: `${crawling ? pct : 100}%` }} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            <div>
              <dt className="text-text-3">Elapsed</dt>
              <dd className="tabular font-medium text-text">{elapsed(job?.startedAt, now)}</dd>
            </div>
            <div>
              <dt className="text-text-3">Discovered</dt>
              <dd className="tabular font-medium text-text">{discovered.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-text-3">Broken so far</dt>
              <dd className={cn("tabular font-medium", (live?.broken ?? 0) > 0 ? "text-critical-ink" : "text-text")}>{(live?.broken ?? 0).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-text-3">Speed</dt>
              <dd className="tabular font-medium text-text">{rate ? `${(rate * 60).toFixed(0)} pages/min` : "n/a"}</dd>
            </div>
          </dl>
          <p className="mt-4 text-[12px] text-text-3">
            SynapseSEOBot respects robots.txt and crawl delays, so larger sites take a few minutes. {hasPrevious ? "The report below shows the previous crawl until this one finishes." : "You can leave this page — you'll get a notification when the audit is ready."}
          </p>
          {job?.status === "failed" && (
            <Callout tone="critical" className="mt-3" title="Crawl failed">
              {job.error}
            </Callout>
          )}
        </div>
        <div className="min-w-0">
          <div className="mb-1.5 text-[12px] font-medium text-text-2">Recently crawled</div>
          <ul className="divide-y divide-border rounded-md border border-border text-[12.5px]">
            {(live?.recent ?? []).length === 0 && <li className="px-3 py-6 text-center text-text-3">Waiting for the first response…</li>}
            {(live?.recent ?? []).map((r, i) => (
              <li key={`${r.url}-${i}`} className="flex items-center gap-2 px-3 py-1.5">
                <span
                  className={cn(
                    "tabular w-9 shrink-0 rounded px-1 text-center text-[11px] font-semibold",
                    r.status == null ? "bg-surface-3 text-text-2" : r.status === 0 || r.status >= 400 ? "bg-critical-soft text-critical-ink" : r.status >= 300 ? "bg-info-soft text-link" : "bg-good-soft text-good-ink",
                  )}
                >
                  {r.status === 0 ? "ERR" : (r.status ?? "—")}
                </span>
                <span className="min-w-0 flex-1 truncate text-text-2" title={r.url}>
                  {r.url.replace(/^https?:\/\//, "")}
                </span>
                <span className="tabular shrink-0 text-text-3">{r.ms != null ? `${r.ms} ms` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

/** "Re-run audit" button: starts a crawl with the saved settings and refreshes into the live view. */
export function RerunButton({ projectId, label = "Re-run audit", variant = "primary" }: { projectId: string; label?: string; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant={variant}
        loading={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await startAudit(projectId);
            if (!res.ok) setError(res.error);
            else router.refresh();
          })
        }
      >
        {!pending && <RotateCw className="h-3.5 w-3.5" />} {label}
      </Button>
      {error && <span className="text-[12px] text-critical-ink">{error}</span>}
    </>
  );
}

/** Re-measure Core Web Vitals for a crawl (PageSpeed Insights), with inline progress. */
export function RemeasureCwvButton({ projectId, crawlId, runningJobId }: { projectId: string; crawlId: string; runningJobId?: string | null }) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(runningJobId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const onFinish = useRef((j: JobPoll) => {
    setJobId(null);
    if (j.status === "failed") setError(j.error ?? "Measurement failed.");
    router.refresh();
  }).current;
  const job = usePoll(jobId, onFinish);
  const busy = pending || !!jobId;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        loading={busy}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await remeasureCwv(projectId, crawlId);
            if (!res.ok) setError(res.error);
            else setJobId(res.data.jobId);
          })
        }
      >
        {!busy && <Gauge className="h-3.5 w-3.5" />} {busy ? (job?.message ?? "Measuring…") : "Measure again"}
      </Button>
      {error && <span className="text-[12px] text-critical-ink">{error}</span>}
    </div>
  );
}
