"use client";

import { ArrowRight, BellOff, CheckCheck, Download, Mail, MailOpen, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteNotificationsAction, deleteReadAction, markAllReadAction, markReadAction } from "@/app/(app)/alerts/actions";
import { downloadCsv } from "@/lib/csv";
import { dateTimeLabel, timeAgo } from "@/lib/format";
import type { NotificationFilter, NotificationItem } from "@/lib/position-tracking/notifications";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Checkbox } from "@/components/ui/input";
import { SeverityBadge, SeverityIcon } from "./severity";

export function NotificationList({ items, toolLabels, filter, filtered, emptyAll }: { items: NotificationItem[]; toolLabels: Record<string, string>; filter: NotificationFilter; filtered: boolean; emptyAll: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      setSelected(new Set());
      router.refresh();
    });
  const open = (n: NotificationItem) =>
    start(async () => {
      if (!n.read) await markReadAction([n.id], true);
      if (n.link) router.push(n.link);
      else router.refresh();
    });
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));
  const ids = [...selected];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Checkbox aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))} disabled={!items.length} />
        {selected.size > 0 ? (
          <>
            <span className="text-[12.5px] text-text-2">{selected.size} selected</span>
            <Button size="sm" onClick={() => run(() => markReadAction(ids, true))} loading={pending}>
              <MailOpen className="h-3.5 w-3.5" /> Mark read
            </Button>
            <Button size="sm" variant="ghost" onClick={() => run(() => markReadAction(ids, false))}>
              <Mail className="h-3.5 w-3.5" /> Mark unread
            </Button>
            <Button size="sm" variant="ghost" className="text-critical-ink" onClick={() => confirm(`Delete ${selected.size} notification${selected.size === 1 ? "" : "s"}?`) && run(() => deleteNotificationsAction(ids))}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </>
        ) : (
          <span className="text-[12.5px] text-text-3">Select notifications for bulk actions</span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!items.length}
            title="Export the notifications on this page as CSV"
            onClick={() =>
              downloadCsv("alerts", [
                ["Date", "Severity", "Tool", "Project", "Title", "Details", "Read", "Link"],
                ...items.map((n) => [n.createdAt, n.severity, toolLabels[n.tool] ?? n.tool, n.projectName, n.title, n.body, n.read ? "yes" : "no", n.link]),
              ])
            }
          >
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          <Button size="sm" onClick={() => run(() => markAllReadAction(filter))} disabled={!items.some((i) => !i.read)} title={filtered ? "Mark every notification matching the filters as read" : "Mark every notification as read"}>
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </Button>
          <Button size="sm" variant="ghost" onClick={() => confirm("Delete all read notifications" + (filtered ? " matching the filters?" : "?")) && run(() => deleteReadAction(filter))} disabled={!items.some((i) => i.read)}>
            <Trash2 className="h-3.5 w-3.5" /> Clear read
          </Button>
        </div>
      </div>
      {error && (
        <Callout tone="critical" className="m-4">
          {error}
        </Callout>
      )}
      {items.length === 0 ? (
        <EmptyState
          icon={<BellOff className="h-5 w-5" />}
          title={emptyAll ? "No alerts yet" : "Nothing matches these filters"}
          description={emptyAll ? "Alerts from Position Tracking rules, Site Audit, Brand Monitoring and other tools will appear here." : "Try another tool, severity or project, or clear the filters."}
        />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((n) => (
            <li key={n.id} className={cn("group flex gap-3 px-4 py-3 transition-colors hover:bg-surface-2", !n.read && "bg-brand-soft/25")}>
              <Checkbox
                className="mt-2.5"
                aria-label={`Select ${n.title}`}
                checked={selected.has(n.id)}
                onChange={() =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (next.has(n.id)) next.delete(n.id);
                    else next.add(n.id);
                    return next;
                  })
                }
              />
              <SeverityIcon severity={n.severity} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
                  <button type="button" onClick={() => open(n)} className={cn("min-w-0 text-left text-[13.5px] hover:text-link hover:underline", n.read ? "text-text-2" : "font-semibold text-text")}>
                    {n.title}
                  </button>
                </div>
                {n.body && <p className="mt-0.5 text-[12.5px] break-words text-text-2">{n.body}</p>}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-text-3">
                  <SeverityBadge severity={n.severity} />
                  <Badge>{toolLabels[n.tool] ?? n.tool}</Badge>
                  {n.projectName && <Badge tone="brand">{n.projectName}</Badge>}
                  <span title={dateTimeLabel(n.createdAt)}>{timeAgo(n.createdAt)}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-start gap-1">
                {n.link && (
                  <Button size="sm" variant="ghost" onClick={() => open(n)} className="hidden sm:inline-flex">
                    View <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="h-7 w-7" title={n.read ? "Mark unread" : "Mark read"} aria-label={n.read ? "Mark unread" : "Mark read"} onClick={() => run(() => markReadAction([n.id], !n.read))}>
                  {n.read ? <Mail className="h-3.5 w-3.5" /> : <MailOpen className="h-3.5 w-3.5" />}
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-text-3 hover:text-critical-ink" title="Delete" aria-label="Delete notification" onClick={() => run(() => deleteNotificationsAction([n.id]))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
