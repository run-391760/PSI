import type { Metadata } from "next";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { NoBrand } from "@/components/cx/inbox/ui";
import { ProfileGroupsClient } from "@/components/cx/ops/profile-groups";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { listChannels } from "@/lib/cx/inbox/channels";
import { LISTEN_SOURCES, sourceLabel } from "@/lib/cx/listening/sources";
import { listGroups } from "@/lib/cx/ops/groups";
import { query } from "@/lib/db";

export const metadata: Metadata = { title: "Profile groups" };

export default async function ProfileGroupsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX" }, { label: "Settings" }, { label: "Profile groups" }];
  if (!brand) return <NoBrand title="Profile groups" breadcrumbs={crumbs} redirect="/cx/settings/profile-groups" />;
  const [groups, channels, sourceCounts, channelCounts] = await Promise.all([
    listGroups(brand.id),
    listChannels(brand.id),
    query<{ source: string; n: number }>("SELECT source, count(*)::int AS n FROM cx_mentions WHERE project_id=$1 GROUP BY source", [brand.id]),
    query<{ channel_id: string; n: number }>("SELECT channel_id, count(*)::int AS n FROM cx_tickets WHERE project_id=$1 AND channel_id IS NOT NULL GROUP BY channel_id", [brand.id]),
  ]);
  const canEdit = ["owner", "admin", "supervisor"].includes(brand.role);
  return (
    <Page>
      <PageHeader
        title="Profile groups"
        subject={brand.name}
        breadcrumbs={crumbs}
        description="Group connected profiles (mailboxes, chat widgets, forms, social accounts) and listening sources under one name, for example “Overall” or “Admissions”. Pick a group in the inbox filter panel, the messages stream and reports to scope every list and counter to it."
        meta={<><Badge tone="info">{groups.length} group{groups.length === 1 ? "" : "s"}</Badge><Badge>{channels.length} connected profile{channels.length === 1 ? "" : "s"}</Badge></>}
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
      />
      <ProfileGroupsClient
        brand={brand.id}
        canEdit={canEdit}
        groups={groups}
        channels={channels.map((c) => ({ id: c.id, kind: c.kind, name: c.name, status: c.status, tickets: channelCounts.find((x) => x.channel_id === c.id)?.n ?? 0 }))}
        sources={LISTEN_SOURCES.map((s) => ({ id: s, label: sourceLabel(s), mentions: sourceCounts.find((x) => x.source === s)?.n ?? 0 }))}
      />
    </Page>
  );
}
