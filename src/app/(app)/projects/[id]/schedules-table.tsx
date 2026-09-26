"use client";

import { CalendarClock, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dateTimeLabel, timeAgo } from "@/lib/format";
import { jobKindLabel } from "@/lib/reports/kinds";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Select } from "@/components/ui/input";
import { updateScheduleAction } from "../actions";

export type ScheduleItem = { kind: string; cadence: "hourly" | "daily" | "weekly"; enabled: boolean; last_run_at: string | null; next_run_at: string };

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50", checked ? "bg-brand" : "bg-border-strong")}
    >
      <span className={cn("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}

/** Recurring tool schedules of a project with enable/disable, cadence and run-now controls. */
export function SchedulesTable({ projectId, schedules }: { projectId: string; schedules: ScheduleItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, start] = useTransition();

  const run = (kind: string, patch: Parameters<typeof updateScheduleAction>[2], msg?: string) => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await updateScheduleAction(projectId, kind, patch);
      setBusy(null);
      if (!res.ok) return setError(res.error);
      if (msg) setNotice(msg);
      router.refresh();
    });
  };

  if (!schedules.length)
    return (
      <EmptyState
        icon={<CalendarClock className="h-5 w-5" />}
        title="No recurring schedules"
        description="Tools such as Site Audit, Position Tracking and Brand Monitoring create a schedule here when you set them up for this project."
      />
    );

  return (
    <div>
      {(error || notice) && (
        <div className="px-4 pb-3">
          {error && <Callout tone="critical">{error}</Callout>}
          {notice && <Callout tone="good">{notice}</Callout>}
        </div>
      )}
      <div className="scroll-thin overflow-x-auto border-t border-border">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface-2 text-left text-[12px] text-text-2">
              <th className="border-b border-border px-4 py-2 font-medium">Tool</th>
              <th className="border-b border-border px-3 py-2 font-medium">Frequency</th>
              <th className="border-b border-border px-3 py-2 font-medium">Enabled</th>
              <th className="border-b border-border px-3 py-2 font-medium">Last run</th>
              <th className="border-b border-border px-3 py-2 font-medium">Next run</th>
              <th className="border-b border-border px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => {
              const k = jobKindLabel(s.kind);
              const loading = busy === s.kind;
              return (
                <tr key={s.kind} className={cn("border-b border-border last:border-0", !s.enabled && "text-text-3")}>
                  <td className="px-4 py-2.5">
                    <Link href={`${k.href}?project=${projectId}`} className="font-medium text-text hover:text-link">
                      {k.tool}
                    </Link>
                    <div className="text-[12px] text-text-3">{k.action}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <Select
                      value={s.cadence}
                      disabled={loading}
                      onChange={(e) => run(s.kind, { cadence: e.target.value as ScheduleItem["cadence"] })}
                      className="h-7 w-28 text-[12.5px]"
                      aria-label={`Frequency of ${k.tool}`}
                    >
                      <option value="hourly">Hourly</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                    </Select>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Switch checked={s.enabled} disabled={loading} onChange={(v) => run(s.kind, { enabled: v })} label={`${s.enabled ? "Disable" : "Enable"} ${k.tool} schedule`} />
                      <Badge tone={s.enabled ? "good" : "neutral"}>{s.enabled ? "On" : "Paused"}</Badge>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-text-2">{s.last_run_at ? <span title={dateTimeLabel(s.last_run_at)} suppressHydrationWarning>{timeAgo(s.last_run_at)}</span> : <span className="text-text-3">Never</span>}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-text-2" suppressHydrationWarning>{s.enabled ? dateTimeLabel(s.next_run_at) : <span className="text-text-3">–</span>}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button size="sm" loading={loading} disabled={!s.enabled} onClick={() => run(s.kind, { runNow: true }, `${k.tool} will start within a minute.`)} title={s.enabled ? "Queue this schedule on the next worker tick" : "Enable the schedule first"}>
                      {!loading && <Play className="h-3.5 w-3.5" />} Run now
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
