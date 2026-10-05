"use client";

import { Hand, ListOrdered, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { pickQueuedAction, queueUnassignedAction, runQueueAction, setMyStatusAction } from "@/app/(app)/cx/inbox/queued/actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Queue toolbar on Queued Tickets: my availability, pick the next waiting ticket, run / fill the queue (supervisors). */
export function QueueControls({ brand, me, statuses, nextId, canManage, readOnly, enabled, unqueued }: {
  brand: string; me: { status: string | null; inQueue: boolean }; statuses: { id: string; name: string }[]; nextId: string | null;
  canManage: boolean; readOnly: boolean; enabled: boolean; unqueued: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (key: string, fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, ok: (d: unknown) => string) => {
    setBusy(key); setMsg(null);
    const r = await fn();
    setBusy(null);
    setMsg(r.ok ? { ok: true, text: ok(r.data) } : { ok: false, text: r.error });
    router.refresh();
  };
  return (
    <>
      {me.inQueue && (
        <Select value={me.status ?? "offline"} disabled={readOnly || busy === "status"} onChange={(e) => run("status", () => setMyStatusAction(brand, e.target.value), () => "Status updated.")} className="h-9 w-auto bg-surface text-[13px]" aria-label="My status">
          <option value="available">● Available</option>
          {statuses.map((s) => <option key={s.id} value={s.id}>❙❙ {s.name}</option>)}
          <option value="offline">○ Offline</option>
        </Select>
      )}
      {!readOnly && <Button variant="primary" disabled={!nextId || !!busy} onClick={() => nextId && run("pick", () => pickQueuedAction(brand, [nextId]), () => "Picked the next ticket.")} title={nextId ? "Assign the next waiting ticket to me" : "Nobody is waiting"}><Hand className="h-4 w-4" />Pick next</Button>}
      {canManage && <Button disabled={!enabled || !!busy} onClick={() => run("run", () => runQueueAction(brand), (d) => `Queue ran: ${(d as { assigned: number }).assigned} assigned.`)} title={enabled ? "Assign waiting tickets now" : "The queue is off"}><Play className="h-4 w-4" /><span className="hidden sm:inline">Run queue</span></Button>}
      {canManage && unqueued > 0 && <Button disabled={!enabled || !!busy} onClick={() => run("queue", () => queueUnassignedAction(brand), (d) => `${(d as { queued: number }).queued} tickets queued.`)}><ListOrdered className="h-4 w-4" /><span className="hidden sm:inline">Queue {unqueued} unqueued</span></Button>}
      {msg && <span role="status" className={cn("w-full text-[12.5px]", msg.ok ? "text-good-ink" : "text-critical-ink")}>{msg.text}</span>}
    </>
  );
}
