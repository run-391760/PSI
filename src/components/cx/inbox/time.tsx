"use client";

import { useEffect, useState } from "react";
import { dateTimeLabel, timeAgo } from "@/lib/format";
import { formatSpan, slaStatus, type SlaClock, type SlaTicket } from "@/lib/cx/inbox/sla";
import { cn } from "@/lib/utils";

/** Re-render every `ms` so relative times and SLA countdowns stay current. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function Ago({ iso, className }: { iso: string | null; className?: string }) {
  useNow();
  if (!iso) return <span className={className}>n/a</span>;
  return (
    <time dateTime={iso} title={dateTimeLabel(iso)} className={className} suppressHydrationWarning>
      {timeAgo(iso)}
    </time>
  );
}

/** Compact SLA indicator for the list: the most urgent running/breached clock. */
export function SlaChip({ ticket }: { ticket: SlaTicket }) {
  const now = useNow();
  const sla = slaStatus(ticket, now);
  const c = [sla.firstResponse, sla.resolution].find((x) => x.state === "breached" && x.remainingMs != null) ?? (sla.firstResponse.state === "running" ? sla.firstResponse : sla.resolution.state === "running" ? sla.resolution : null);
  if (!c || c.remainingMs == null) return null;
  const which = c === sla.firstResponse ? "reply" : "resolve";
  const late = c.remainingMs < 0;
  const soon = !late && c.remainingMs < 30 * 60_000;
  return (
    <span suppressHydrationWarning className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums", late ? "bg-critical-soft text-critical-ink" : soon ? "bg-warning-soft text-warning-ink" : "bg-surface-3 text-text-2")} title={`${which === "reply" ? "First response" : "Resolution"} due ${dateTimeLabel(c.due!)}`}>
      {late ? `${which} overdue ${formatSpan(c.remainingMs)}` : `${which} in ${formatSpan(c.remainingMs)}`}
    </span>
  );
}

export function SlaClockRow({ label, c }: { label: string; c: SlaClock }) {
  useNow();
  const text =
    c.state === "n/a" ? "n/a"
    : c.state === "met" ? "Met"
    : c.state === "paused" ? "Stopped (ticket solved)"
    : c.remainingMs == null ? (c.state === "breached" ? "Missed" : "n/a")
    : c.remainingMs < 0 ? `Overdue by ${formatSpan(c.remainingMs)}`
    : `Due in ${formatSpan(c.remainingMs)}`;
  const tone = c.state === "breached" ? "text-critical-ink" : c.state === "met" ? "text-good-ink" : c.remainingMs != null && c.remainingMs < 30 * 60_000 ? "text-warning-ink" : "text-text";
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-[12.5px]">
      <span className="text-text-3">{label}</span>
      <span className="text-right">
        <span className={cn("font-medium", tone)} suppressHydrationWarning>{text}</span>
        {c.due && <span className="block text-[11.5px] text-text-3" suppressHydrationWarning>{dateTimeLabel(c.due)}</span>}
      </span>
    </div>
  );
}
