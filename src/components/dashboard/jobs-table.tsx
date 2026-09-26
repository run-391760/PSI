"use client";

import { Ban, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { cancelJobAction, retryJobAction } from "@/app/(app)/activity/actions";
import { dateTimeLabel, duration, timeAgo } from "@/lib/format";
import { jobDuration, jobKindLabel, type JobListRow } from "@/lib/reports/kinds";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Callout } from "@/components/ui/feedback";
import { JobProgress, JobStatusBadge } from "./job-status";

type Update = Pick<JobListRow, "id" | "status" | "progress" | "total" | "message" | "error" | "started_at" | "finished_at">;
const isActive = (j: Pick<JobListRow, "status">) => j.status === "queued" || j.status === "running";

/**
 * Background jobs table with live progress: while any job is queued/running it polls
 * /api/activity every 2 s, merges progress into the rows and refreshes the page when a job finishes.
 */
export function JobsTable({ rows: initial, showProject = true, exportName = "jobs", emptyText = "No jobs match these filters." }: { rows: JobListRow[]; showProject?: boolean; exportName?: string; emptyText?: string }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [, start] = useTransition();
  useEffect(() => setRows(initial), [initial]);

  const activeIds = useMemo(() => rows.filter(isActive).map((r) => r.id), [rows]);
  const key = activeIds.join(",");
  const refreshing = useRef(false);
  useEffect(() => {
    if (!key) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/activity?ids=${key}`, { cache: "no-store" });
        if (!res.ok || stop) return;
        const { jobs } = (await res.json()) as { jobs: Update[] };
        const byId = new Map(jobs.map((j) => [j.id, j]));
        let finished = false;
        setRows((prev) =>
          prev.map((r) => {
            const u = byId.get(r.id);
            if (!u) return r;
            if (isActive(r) && !isActive(u)) finished = true;
            return { ...r, ...u };
          }),
        );
        setNow(Date.now());
        if (finished && !refreshing.current) {
          refreshing.current = true;
          router.refresh();
          setTimeout(() => (refreshing.current = false), 1500);
        }
      } catch {
        /* network hiccup: try again on the next tick */
      }
    };
    const t = setInterval(tick, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [key, router]);

  const act = (id: string, kind: "cancel" | "retry") => {
    setBusy(id);
    setError(null);
    start(async () => {
      const res = kind === "cancel" ? await cancelJobAction(id) : await retryJobAction(id);
      setBusy(null);
      if (!res.ok) return setError(res.error);
      if (kind === "cancel") setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "cancelled", finished_at: new Date().toISOString() } : r)));
      router.refresh();
    });
  };

  const columns = useMemo<Column<JobListRow>[]>(() => {
    const cols: Column<JobListRow>[] = [
      {
        key: "kind",
        header: "Job",
        sortValue: (r) => r.kind,
        csv: (r) => r.kind,
        render: (r) => {
          const k = jobKindLabel(r.kind);
          return (
            <div className="min-w-[150px]">
              <Link href={k.href} className="font-medium text-text hover:text-link">
                {k.tool}
              </Link>
              <div className="text-[12px] text-text-3">
                {k.action}
                {r.attempts > 1 && <span> · attempt {r.attempts}</span>}
              </div>
            </div>
          );
        },
      },
    ];
    if (showProject)
      cols.push({
        key: "project",
        header: "Project",
        sortValue: (r) => r.project_name ?? "",
        csv: (r) => r.project_domain ?? "",
        render: (r) =>
          r.project_id ? (
            <Link href={`/projects/${r.project_id}`} className="block max-w-[180px] truncate text-link hover:underline" title={r.project_domain ?? ""}>
              {r.project_name ?? r.project_domain}
            </Link>
          ) : (
            <span className="text-text-3">–</span>
          ),
      });
    cols.push(
      { key: "status", header: "Status", sortValue: (r) => r.status, render: (r) => <JobStatusBadge status={r.status} /> },
      {
        key: "progress",
        header: "Progress",
        sortValue: (r) => (r.total ? r.progress / r.total : r.status === "done" ? 1 : 0),
        csv: (r) => (r.total ? `${r.progress}/${r.total}` : ""),
        render: (r) => (
          <div className="w-36">
            <JobProgress job={r} />
            {r.total > 0 && (
              <div className="tabular mt-0.5 text-[11px] text-text-3">
                {r.progress.toLocaleString()} / {r.total.toLocaleString()}
              </div>
            )}
          </div>
        ),
      },
      {
        key: "message",
        header: "Message",
        sortable: false,
        csv: (r) => r.error || r.message || "",
        render: (r) =>
          r.error ? (
            <span className="line-clamp-2 block max-w-[320px] text-[12.5px] break-words text-critical-ink" title={r.error}>
              {r.error}
            </span>
          ) : (
            <span className="line-clamp-2 block max-w-[320px] text-[12.5px] text-text-2" title={r.message ?? ""}>
              {r.message || <span className="text-text-3">–</span>}
            </span>
          ),
      },
      {
        key: "created_at",
        header: "Created",
        align: "right",
        sortValue: (r) => r.created_at,
        render: (r) => (
          <span className="whitespace-nowrap text-text-2" title={dateTimeLabel(r.created_at)} suppressHydrationWarning>
            {timeAgo(r.created_at)}
          </span>
        ),
      },
      {
        key: "duration",
        header: "Duration",
        align: "right",
        sortValue: (r) => jobDuration(r, now),
        csv: (r) => jobDuration(r, now)?.toFixed(1),
        render: (r) => {
          const d = jobDuration(r, now);
          return <span className="tabular whitespace-nowrap text-text-2" suppressHydrationWarning>{d == null ? "–" : duration(d)}</span>;
        },
      },
      {
        key: "actions",
        header: "",
        sortable: false,
        noExport: true,
        align: "right",
        render: (r) =>
          isActive(r) ? (
            <Button size="sm" variant="ghost" loading={busy === r.id} onClick={() => act(r.id, "cancel")} aria-label="Cancel job">
              {busy !== r.id && <Ban className="h-3.5 w-3.5" />} Cancel
            </Button>
          ) : r.status === "failed" || r.status === "cancelled" ? (
            <Button size="sm" variant="ghost" loading={busy === r.id} onClick={() => act(r.id, "retry")} aria-label="Retry job">
              {busy !== r.id && <RotateCcw className="h-3.5 w-3.5" />} Retry
            </Button>
          ) : null,
      },
    );
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showProject, now, busy]);

  return (
    <div>
      {error && (
        <div className="px-4 pb-3">
          <Callout tone="critical">{error}</Callout>
        </div>
      )}
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} defaultSort={{ key: "created_at", dir: "desc" }} searchable searchPlaceholder="Filter jobs" searchText={(r) => `${r.kind} ${jobKindLabel(r.kind).tool} ${r.project_name ?? ""} ${r.project_domain ?? ""} ${r.message ?? ""} ${r.error ?? ""}`} exportName={exportName} emptyText={emptyText} />
    </div>
  );
}
