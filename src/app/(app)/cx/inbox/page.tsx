import type { Metadata } from "next";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { InboxClient } from "@/components/cx/inbox/inbox-client";
import { NoBrand } from "@/components/cx/inbox/ui";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { requirePageUser } from "@/lib/auth";
import { aiConfigured } from "@/lib/cx/ai";
import { cxContext } from "@/lib/cx/context";
import { listCanned, listAgents, listTags, listTeams, listTickets, getTicket, inboxStats, slaPolicyCount, viewCounts, VIEWS, type View } from "@/lib/cx/inbox/store";
import { listChannels } from "@/lib/cx/inbox/channels";
import { ensureInboxJobs } from "@/lib/cx/inbox/jobs";

export const metadata: Metadata = { title: "Inbox & tickets" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX" }, { label: "Inbox & tickets" }];
  if (!brand) return <NoBrand title="Inbox & tickets" breadcrumbs={crumbs} redirect="/cx/inbox" />;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const view = (VIEWS.some((v) => v.id === s("view")) ? s("view") : "open") as View;
  const filters = { view, q: s("q"), channel: s("channel"), priority: s("priority"), status: s("status"), tag: s("tag"), team: s("team"), sentiment: s("sentiment") };
  const channels = await listChannels(brand.id);
  await ensureInboxJobs(brand.id, user.id, channels.some((c) => c.kind === "email" && c.status !== "paused")).catch(() => {});
  const [tickets, counts, stats, agents, teams, tags, canned, policies] = await Promise.all([
    listTickets(brand.id, user.id, filters),
    viewCounts(brand.id, user.id),
    inboxStats(brand.id),
    listAgents(brand.id),
    listTeams(brand.id),
    listTags(brand.id),
    listCanned(brand.id),
    slaPolicyCount(brand.id),
  ]);
  const ticketId = s("t") ?? s("ticket"); // ?ticket= is the deep link used by Listening
  const selected = ticketId ? await getTicket(brand.id, ticketId) : null;
  return (
    <Page wide>
      <PageHeader
        title="Inbox & tickets"
        subject={brand.name}
        breadcrumbs={crumbs}
        meta={
          <>
            <Badge tone="info">{channels.filter((c) => c.status !== "paused").length} channels</Badge>
            <Badge>{policies ? `SLA policies for ${policies} of 4 priorities (others: 1h / 24h)` : "Default SLA: 1h first response · 24h resolution"}</Badge>
          </>
        }
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
      />
      <InboxClient
        brand={{ id: brand.id, name: brand.name }}
        me={{ id: user.id, name: user.name || user.email }}
        filters={filters}
        tickets={tickets}
        counts={counts}
        stats={stats}
        agents={agents}
        teams={teams}
        tags={tags}
        canned={canned}
        channels={channels.map((c) => ({ id: c.id, kind: c.kind, name: c.name }))}
        selected={selected}
        ai={aiConfigured()}
      />
    </Page>
  );
}
