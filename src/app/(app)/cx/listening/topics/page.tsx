import type { Metadata } from "next";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { JobButton } from "@/components/cx/listening/job-button";
import { ListeningNav } from "@/components/cx/listening/listening-nav";
import { NoBrand } from "@/components/cx/listening/no-brand";
import { SourceStatusList } from "@/components/cx/listening/source-status";
import { TopicsManager } from "@/components/cx/listening/topics-manager";
import { Page, PageHeader } from "@/components/shell/page";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { getSettings, listTopics, sourceStatuses } from "@/lib/cx/listening/data";
import { dateTimeLabel, timeAgo } from "@/lib/format";
import { getSchedule, latestJob } from "@/lib/jobs/queue";

export const metadata: Metadata = { title: "Listening topics" };

export default async function Page_({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Topics & sources" />;
  const [topics, settings, schedule, job] = await Promise.all([listTopics(brand.id), getSettings(brand.id), getSchedule(brand.id, "cx.listening.fetch"), latestJob(brand.id, "cx.listening.fetch")]);
  const sources = sourceStatuses();
  const running = job && ["queued", "running"].includes(job.status) ? job.id : null;
  const brandTerm = brand.brand_terms?.[0] ?? brand.name;

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX" }, { label: "Listening", href: `/cx/listening?brand=${brand.id}` }, { label: "Topics & sources" }]}
        title="Topics & sources"
        subject={brand.name}
        description="What to listen for: your brand, competitors, campaigns and industry terms, and where to listen."
        actions={
          <>
            <BrandSwitcher brands={switcher} current={brand.id} />
            {topics.length > 0 && <JobButton brandId={brand.id} kind="fetch" initialJobId={running} />}
          </>
        }
      />
      <ListeningNav current="/cx/listening/topics" brandId={brand.id} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <TopicsManager
            brandId={brand.id}
            topics={topics.map((t) => ({ id: t.id, name: t.name, kind: t.kind, keywords: t.keywords, excluded: t.excluded, sources: t.sources, languages: t.languages, app_ids: t.app_ids, active: t.active, mentions: t.mentions, last_mention: t.last_mention }))}
            available={Object.fromEntries(sources.map((s) => [s.source, s.available]))}
            defaults={{ name: brand.name, keyword: brandTerm }}
          />
          {topics.length === 0 && (
            <div className="mt-3 rounded-lg border border-dashed border-border-strong px-4 py-8 text-center text-[13px] text-text-2">
              No topics yet. Add your brand first, then competitors to compare share of voice.
            </div>
          )}
        </div>
        <div className="grid content-start gap-5">
          <Card>
            <CardHeader title="Schedule" description="Mentions are fetched hourly once a topic exists; spike detection runs after every fetch." />
            <CardBody className="grid gap-1.5 text-[13px]">
              <Row label="Status">{schedule?.enabled ? `Hourly` : "Not scheduled (add a topic)"}</Row>
              <Row label="Last fetch">{settings.lastFetchAt ? `${timeAgo(settings.lastFetchAt)}` : "n/a"}</Row>
              <Row label="Next fetch">{schedule?.enabled && schedule.next_run_at ? dateTimeLabel(schedule.next_run_at) : "n/a"}</Row>
              <Row label="New in last fetch">{"inserted" in settings.lastFetch ? settings.lastFetch.inserted : "n/a"}</Row>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Sources" description="Free sources work out of the box; keyed sources need server credentials." />
            <SourceStatusList sources={sources} report={settings.lastFetch} />
          </Card>
        </div>
      </div>
    </Page>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-text-3">{label}</span>
      <span className="text-right text-text">{children}</span>
    </div>
  );
}
