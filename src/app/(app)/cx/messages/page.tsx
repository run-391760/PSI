import type { Metadata } from "next";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { NoBrand } from "@/components/cx/inbox/ui";
import { MessagesStream } from "@/components/cx/ops/messages-stream";
import { Page, PageHeader } from "@/components/shell/page";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { listChannels } from "@/lib/cx/inbox/channels";
import { listAgents } from "@/lib/cx/inbox/store";
import { listGroups } from "@/lib/cx/ops/groups";
import { listMessages, messageStats } from "@/lib/cx/ops/messages";
import { num } from "@/lib/format";

export const metadata: Metadata = { title: "All messages" };

export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX" }, { label: "All messages" }];
  if (!brand) return <NoBrand title="All messages" breadcrumbs={crumbs} redirect="/cx/messages" />;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const filters = { q: s("q"), direction: s("direction"), channel: s("channel"), group: s("group"), media: s("media"), from: s("from"), to: s("to"), agent: s("agent"), sentiment: s("sentiment") };
  const page = Math.max(1, Number(s("page")) || 1);
  const [{ total, rows }, stats, channels, groups, agents] = await Promise.all([
    listMessages(brand.id, user.id, filters, page, 50), messageStats(brand.id), listChannels(brand.id), listGroups(brand.id), listAgents(brand.id),
  ]);
  return (
    <Page>
      <PageHeader
        title="All messages"
        subject={brand.name}
        breadcrumbs={crumbs}
        description="Every message across all tickets in one stream, newest first: customer messages, your team's replies and private notes. Open the ticket from any message or bookmark it."
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
      />
      <MetricStrip className="mb-4 grid-cols-2 divide-y-0 sm:grid-cols-none">
        <Metric label="Messages today" value={num(stats.today)} size="sm" />
        <Metric label="Received (7d)" value={num(stats.week_in)} size="sm" />
        <Metric label="Sent (7d)" value={num(stats.week_out)} size="sm" />
        <Metric label="Private notes (7d)" value={num(stats.week_note)} size="sm" />
        <Metric label="Matching filters" value={num(total)} size="sm" />
      </MetricStrip>
      <MessagesStream
        brand={brand.id}
        filters={Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, v ?? ""])) as Record<keyof typeof filters, string>}
        rows={rows}
        total={total}
        page={page}
        pageSize={50}
        channels={[...new Set(channels.map((c) => c.kind))]}
        groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        agents={agents.map((a) => ({ id: a.id, name: a.name }))}
      />
    </Page>
  );
}
