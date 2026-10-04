import type { Metadata } from "next";
import Link from "next/link";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { NoBrand } from "@/components/cx/inbox/ui";
import { QueuedClient } from "@/components/cx/ops/queued-client";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { requirePageUser } from "@/lib/auth";
import { ASSIGNMENT_TYPES } from "@/lib/cx/admin/pure/queue";
import { listStatuses } from "@/lib/cx/admin/queue";
import { can } from "@/lib/cx/admin/roles";
import { cxContext } from "@/lib/cx/context";
import { queuedTickets, unqueuedCount } from "@/lib/cx/ops/queued";
import { num } from "@/lib/format";
import { waitLabel } from "@/lib/cx/ops/model";

export const metadata: Metadata = { title: "Queued tickets" };

export default async function QueuedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX" }, { label: "Inbox & tickets", href: brand ? `/cx/inbox?brand=${brand.id}` : "/cx/inbox" }, { label: "Queued tickets" }];
  if (!brand) return <NoBrand title="Queued tickets" breadcrumbs={crumbs} redirect="/cx/inbox/queued" />;
  const [{ settings, agents, rows }, statuses, unqueued, manage] = await Promise.all([
    queuedTickets(brand.id), listStatuses(brand.id), unqueuedCount(brand.id), can(brand.id, user.id, "manage_queue").catch(() => false),
  ]);
  const waiting = rows.filter((r) => !r.assignee_id);
  const now = Date.now();
  const oldest = waiting.length ? Math.max(0, ...waiting.map((r) => now - Date.parse(r.queued_at))) : null;
  const avgWait = waiting.length ? waiting.reduce((a, r) => a + Math.max(0, now - Date.parse(r.queued_at)), 0) / waiting.length : null;
  const available = agents.filter((a) => a.status === "available" && !a.paused);
  const me = agents.find((a) => a.id === user.id) ?? null;
  const type = ASSIGNMENT_TYPES.find((t) => t.value === settings.assignmentType);
  return (
    <Page wide>
      <PageHeader
        title="Queued tickets"
        subject={brand.name}
        breadcrumbs={crumbs}
        description="Tickets waiting in the assignment queue, in the order the queue hands them out (segment weight, priority, SLA due, age), plus tickets the queue assigned that nobody has worked on yet."
        meta={<>
          <Badge tone={settings.enabled ? "good" : "neutral"}>{settings.enabled ? "Queue on" : "Queue off"}</Badge>
          {type && <Badge>{type.label}</Badge>}
          <Badge tone="info">{available.length} of {agents.length} agents available</Badge>
        </>}
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
      />
      {!settings.enabled && (
        <Callout tone="warning" className="mb-4" title="Automatic assignment is off">
          Tickets only enter this queue when the queue is enabled. {manage ? <Link href={`/cx/settings/queue?brand=${brand.id}`} className="text-link hover:underline">Turn it on in Settings → Queue &amp; assignment →</Link> : "Ask a brand admin to turn it on in Settings → Queue & assignment."} You can still pick tickets that are already queued.
        </Callout>
      )}
      <MetricStrip className="mb-4 grid-cols-2 divide-y-0 sm:grid-cols-none">
        <Metric label="Waiting" value={num(waiting.length)} size="sm" info="Queued and not assigned to anyone." />
        <Metric label="Assigned, not started" value={num(rows.filter((r) => r.assignee_id && !r.worked).length)} size="sm" info="The queue assigned these but the agent hasn't replied or noted yet." />
        <Metric label="Longest wait" value={oldest == null ? "n/a" : waitLabel(oldest)} size="sm" />
        <Metric label="Average wait" value={avgWait == null ? "n/a" : waitLabel(avgWait)} size="sm" />
        <Metric label="Open, not queued" value={num(unqueued)} size="sm" info="Open unassigned tickets outside the queue (e.g. created before the queue was enabled)." />
      </MetricStrip>
      <QueuedClient
        brand={brand.id}
        me={{ id: user.id, status: me ? (me.statusId ?? me.status) : null, statusName: me?.statusName ?? null, inQueue: !!me, paused: me?.paused ?? false }}
        canManage={manage}
        readOnly={brand.role === "viewer"}
        enabled={settings.enabled}
        unqueued={unqueued}
        rows={rows}
        agents={agents.map((a) => ({ id: a.id, name: a.name, status: a.status, statusName: a.statusName, paused: a.paused, load: a.load, capacity: a.capacity, overrun: a.overrun }))}
        statuses={statuses.map((s) => ({ id: s.id, name: s.name, available: s.available }))}
        segments={settings.segments.map((s) => s.name)}
      />
    </Page>
  );
}
