import type { Metadata } from "next";
import { Suspense } from "react";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { JobButton } from "@/components/cx/listening/job-button";
import { NoBrand } from "@/components/cx/listening/no-brand";
import { Page } from "@/components/shell/page";
import { SectionLayout, SectionPanel } from "@/components/shell/section-panel";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { ipBlocked } from "@/lib/cx/admin/ip";
import { permissionsFor } from "@/lib/cx/admin/roles";
import { getSettings, listTopics, sourceStatuses } from "@/lib/cx/listening/data";
import { dateTimeLabel, timeAgo } from "@/lib/format";
import { getSchedule, latestJob } from "@/lib/jobs/queue";
import { TopicsPanelIcons } from "./panel-icons";
import { TopicEditor } from "./topic-editor";

export const metadata: Metadata = { title: "Topics" };

/** Topic editor (Konnect "Topics"): TOPICS panel with the topic list, the generated search query and the editor. */
export default async function TopicsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Topics" />;
  const blocked = await ipBlocked(brand.id, user.id);
  if (blocked)
    return (
      <Page><Card><EmptyState title="Your IP address isn't allowed for this brand" description={`This brand only accepts access from approved IP addresses. Your address is ${blocked}.`} /></Card></Page>
    );
  const [topics, settings, schedule, job, perms] = await Promise.all([listTopics(brand.id), getSettings(brand.id), getSchedule(brand.id, "cx.listening.fetch"), latestJob(brand.id, "cx.listening.fetch"), permissionsFor(brand.id, user.id)]);
  const canEdit = brand.role !== "viewer" && perms.perms.includes("page:listening");
  const hidePaused = sp.paused === "hide";
  const requested = typeof sp.topic === "string" ? sp.topic : null;
  const topic = requested === "new" ? null : topics.find((t) => t.id === requested) ?? (requested ? null : topics[0] ?? null);
  const isNew = requested === "new" || (!topic && topics.length === 0);
  const listed = topics.filter((t) => !hidePaused || t.active || t.id === topic?.id);
  const running = job && ["queued", "running"].includes(job.status) ? job.id : null;
  const sources = sourceStatuses().map((s) => ({ source: s.source, name: s.name, available: s.available, costNote: s.costNote, env: s.env }));
  const base = `/cx/listening/topics?brand=${brand.id}${hidePaused ? "&paused=hide" : ""}`;
  const first = !topics.length;

  const panel = (
    <Suspense fallback={<div className="lg:w-[208px]" />}>
      <SectionPanel
        title="Topics"
        keep={["brand", "paused"]}
        icons={<TopicsPanelIcons brand={brand.id} canFetch={canEdit && topics.length > 0} />}
        groups={[{ items: listed.map((t, i) => ({ href: `/cx/listening/topics?topic=${t.id}`, label: t.name, isDefault: i === 0 && !requested, badge: t.active ? undefined : "Paused" })) }]}
      >
        {!listed.length && <p className="pb-2 text-[12.5px] text-text-3">{topics.length ? "Every topic is paused." : "No topics yet."}</p>}
      </SectionPanel>
    </Suspense>
  );

  return (
    <SectionLayout panel={panel}>
      <Page wide>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-text-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">{topics.filter((t) => t.active).length} active topic{topics.filter((t) => t.active).length === 1 ? "" : "s"}</Badge>
            <span>Last fetch {settings.lastFetchAt ? timeAgo(settings.lastFetchAt) : "never"}</span>
            {schedule?.enabled && schedule.next_run_at && <span>· next check {dateTimeLabel(schedule.next_run_at)}</span>}
            {topic && <span>· {topic.mentions} mentions{topic.last_mention ? `, latest ${timeAgo(topic.last_mention)}` : ""}</span>}
          </div>
          <div className="flex items-center gap-2">
            {canEdit && topics.length > 0 && <JobButton brandId={brand.id} kind="fetch" initialJobId={running} variant="secondary" />}
            <BrandSwitcher brands={switcher} current={brand.id} />
          </div>
        </div>
        <TopicEditor
          key={isNew ? "new" : topic?.id ?? "none"}
          brand={brand.id}
          topic={isNew ? null : topic}
          sources={sources}
          defaults={first ? { name: brand.name, keyword: brand.brand_terms?.[0] ?? brand.name } : { name: "", keyword: "" }}
          canEdit={canEdit}
          base={base}
        />
      </Page>
    </SectionLayout>
  );
}
