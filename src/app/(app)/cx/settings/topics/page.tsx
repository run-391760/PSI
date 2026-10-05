import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { listTopics } from "@/lib/cx/listening/data";
import { settingsPage, SettingsHeader } from "../_admin/settings-page";
import { TopicsTable } from "./topics-table";

export const metadata: Metadata = { title: "Topics" };

export default async function SettingsTopicsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { el, ctx } = await settingsPage(await searchParams, { title: "Topics", path: "/cx/settings/topics", perm: "page:listening" });
  if (!ctx) return el;
  const topics = await listTopics(ctx.brand.id);
  return (
    <Page>
      <SettingsHeader title="Topics" ctx={ctx} description="Keyword sets listening collects mentions for. Open a topic to edit its query, sources, regions, exclusions and activation." />
      <TopicsTable
        brand={ctx.brand.id}
        canEdit={ctx.canEdit}
        topics={topics.map((t) => ({ id: t.id, name: t.name, active: t.active, contains: t.keywords, andContains: t.and_contains, excluded: t.excluded, creator: t.created_by_name, createdAt: t.created_at, mentions: t.mentions }))}
      />
    </Page>
  );
}
