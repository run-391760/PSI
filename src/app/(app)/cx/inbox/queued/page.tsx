import type { Metadata } from "next";
import Link from "next/link";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { CardStream } from "@/components/cx/inbox/stream-page";
import { NoBrand } from "@/components/cx/inbox/ui";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/feedback";
import { requirePageUser } from "@/lib/auth";
import { ASSIGNMENT_TYPES } from "@/lib/cx/admin/pure/queue";
import { listStatuses } from "@/lib/cx/admin/queue";
import { can } from "@/lib/cx/admin/roles";
import { cxContext } from "@/lib/cx/context";
import { streamPageData } from "@/lib/cx/inbox/page-data";
import { parseStreamFilters } from "@/lib/cx/inbox/stream";
import { queuedStream } from "@/lib/cx/inbox/streams";
import { unqueuedCount } from "@/lib/cx/ops/queued";
import { waitLabel } from "@/lib/cx/ops/model";

export const metadata: Metadata = { title: "Queued tickets" };

/** Queued Tickets (Konnect OMNI-CHANNEL TICKETS → Queued Tickets): the assignment queue as ticket cards. */
export default async function QueuedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX" }, { label: "Omni-channel tickets" }, { label: "Queued tickets" }];
  if (!brand) return <NoBrand title="Queued tickets" breadcrumbs={crumbs} redirect="/cx/inbox/queued" />;
  const parsed = parseStreamFilters(sp);
  const f = { ...parsed, sort: typeof sp.sort === "string" ? parsed.sort : "oldest", channel: typeof sp.channel === "string" ? sp.channel : undefined, scope: typeof sp.scope === "string" ? sp.scope : undefined };
  const [data, q, statuses, unqueued, manage] = await Promise.all([
    streamPageData(brand, user), queuedStream(brand.id, user.id, f), listStatuses(brand.id), unqueuedCount(brand.id), can(brand.id, user.id, "manage_queue").catch(() => false),
  ]);
  const waiting = q.rows.filter((r) => !r.assignee_id);
  const now = Date.now();
  const oldest = waiting.length ? Math.max(0, ...waiting.map((r) => now - Date.parse(r.queued_at))) : null;
  const meAgent = q.agents.find((a) => a.id === user.id);
  const next = [...waiting].sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9))[0];
  const type = ASSIGNMENT_TYPES.find((t) => t.value === q.settings.assignmentType);
  return (
    <Page wide>
      <PageHeader title="Queued tickets" subject={brand.name} breadcrumbs={crumbs} className="mb-4"
        meta={<>
          <Badge tone={q.settings.enabled ? "good" : "neutral"}>{q.settings.enabled ? "Queue on" : "Queue off"}</Badge>
          {type && <Badge>{type.label}</Badge>}
          <Badge tone="info">{waiting.length} waiting · {q.rows.length - waiting.length} assigned</Badge>
          {oldest != null && <Badge tone={oldest > 3_600_000 ? "warning" : "neutral"}>Longest wait {waitLabel(oldest)}</Badge>}
        </>}
        actions={<BrandSwitcher brands={switcher} current={brand.id} />} />
      {!q.settings.enabled && (
        <Callout tone="warning" className="mb-4" title="Automatic assignment is off">
          Tickets only enter this queue while the queue is on. {manage ? <Link href={`/cx/settings/queue?brand=${brand.id}`} className="text-link hover:underline">Turn it on in Settings → Queue &amp; assignment →</Link> : "Ask a brand admin to turn it on."}
        </Callout>
      )}
      <CardStream
        ctx={data.ctx} prefs={data.prefs} cards={q.cards} facets={q.facets} variant="queued" scopeOptions={data.scope} users={q.users}
        more={{ sentiment: true }} total={q.cards.length} defaultSort="oldest" searchPlaceholder="Search queued tickets"
        queue={{ brand: brand.id, me: { status: meAgent ? (meAgent.statusId ?? meAgent.status) : null, inQueue: !!meAgent }, statuses: statuses.map((s) => ({ id: s.id, name: s.name })), nextId: next?.id ?? null, canManage: manage, readOnly: brand.role === "viewer", enabled: q.settings.enabled, unqueued }}
        empty={q.total ? { title: "No queued tickets match", description: "Clear the filters to see the whole queue." } : { title: "The queue is empty", description: "Tickets waiting for an agent, and tickets the queue assigned but nobody has worked on yet, appear here." }}
      />
    </Page>
  );
}
