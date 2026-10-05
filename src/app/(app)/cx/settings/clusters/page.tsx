import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { query } from "@/lib/db";
import { isListenSource, sourceLabel } from "@/lib/cx/listening/sources";
import { listGroups } from "@/lib/cx/ops/groups";
import { settingsPage, SettingsHeader } from "../_admin/settings-page";
import { ClustersClient, type PickItem } from "./clusters-client";

export const metadata: Metadata = { title: "Clusters" };

export default async function ClustersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { el, ctx } = await settingsPage(await searchParams, { title: "Clusters", path: "/cx/settings/clusters", perm: null });
  if (!ctx) return el;
  const id = ctx.brand.id;
  const [groups, channels, topics, used] = await Promise.all([
    listGroups(id),
    query<{ id: string; name: string; kind: string }>("SELECT id,name,kind FROM cx_channels WHERE project_id=$1 ORDER BY kind, lower(name)", [id]),
    query<{ id: string; name: string }>("SELECT id,name FROM cx_topics WHERE project_id=$1 ORDER BY lower(name)", [id]),
    query<{ s: string }>("SELECT DISTINCT source AS s FROM cx_mentions WHERE project_id=$1", [id]),
  ]);
  const sources = [...new Set([...used.map((u) => u.s), ...groups.flatMap((g) => g.sources)])].filter(isListenSource);
  const items: PickItem[] = [
    ...channels.map((c) => ({ id: c.id, name: c.name, network: c.kind, type: "channel" as const })),
    ...topics.map((t) => ({ id: t.id, name: t.name, network: "topic", type: "topic" as const })),
    ...sources.map((s) => ({ id: `source:${s}`, name: `${sourceLabel(s)} (all mentions)`, network: s, type: "source" as const })),
  ];
  const canEdit = ctx.canEdit && ctx.perms.includes("page:settings.channels");
  return (
    <Page>
      <SettingsHeader title="Clusters" ctx={ctx} description="Named groups of profiles and topics, for example “Overall” or one per campus. Pick a cluster in Tickets, All Messages and Reports to scope every list, counter and chart to it."
        meta={<><Badge tone="info">{groups.length} cluster{groups.length === 1 ? "" : "s"}</Badge><Badge>{channels.length} profiles · {topics.length} topics</Badge></>} />
      <ClustersClient
        brand={id}
        canEdit={canEdit}
        items={items}
        clusters={groups.map((g) => ({ id: g.id, name: g.name, color: g.color, isDefault: g.isDefault, channelIds: g.channelIds, topicIds: g.topicIds, sources: g.sources, creator: g.creator, createdAt: g.createdAt }))}
      />
    </Page>
  );
}
