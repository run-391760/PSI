import { Download, Radar, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { JobButton } from "@/components/cx/listening/job-button";
import { ListeningNav } from "@/components/cx/listening/listening-nav";
import { MentionsFeed } from "@/components/cx/listening/mentions-feed";
import { NoBrand } from "@/components/cx/listening/no-brand";
import { Page, PageHeader } from "@/components/shell/page";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/input";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { getSettings, listMentions, listTopics, mentionFacets, readFilters } from "@/lib/cx/listening/data";
import { INTENTS, LISTEN_SOURCES, SENTIMENTS, SOURCE_LABELS, languageName } from "@/lib/cx/listening/sources";
import { num, timeAgo } from "@/lib/format";
import { latestJob } from "@/lib/jobs/queue";

export const metadata: Metadata = { title: "Mentions" };
const PAGE_SIZE = 50;

export default async function MentionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Mentions" />;
  const filters = readFilters(sp);
  const page = Math.max(1, Number(sp.page) || 1);
  const [topics, facets, settings, job, feed] = await Promise.all([
    listTopics(brand.id),
    mentionFacets(brand.id),
    getSettings(brand.id),
    latestJob(brand.id, "cx.listening.fetch"),
    listMentions(brand.id, filters, page, PAGE_SIZE),
  ]);
  const running = job && ["queued", "running"].includes(job.status) ? job.id : null;
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    p.set("brand", brand.id);
    for (const [k, v] of Object.entries({ ...filters, ...extra })) if (v) p.set(k, v);
    return p.toString();
  };
  const filtered = Object.values(filters).some(Boolean);
  const pages = Math.max(1, Math.ceil(feed.total / PAGE_SIZE));

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX" }, { label: "Listening" }, { label: "Mentions" }]}
        title="Mentions"
        subject={brand.name}
        description="Every stored mention of your topics across news, forums, social networks and app stores."
        actions={
          <>
            <BrandSwitcher brands={switcher} current={brand.id} />
            {topics.length > 0 && <JobButton brandId={brand.id} kind="fetch" initialJobId={running} />}
          </>
        }
      />
      <ListeningNav current="/cx/listening" brandId={brand.id} counts={{ "/cx/listening": facets.unread }} />

      {topics.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Radar className="h-5 w-5" />}
            title="Add a topic to start listening"
            description="Topics define the keywords to monitor (your brand, competitors, campaigns). Free sources such as Google News, Hacker News, Mastodon and App Store reviews work without any setup."
            action={<ButtonLink href={`/cx/listening/topics?brand=${brand.id}`} variant="primary">Add a topic</ButtonLink>}
          />
        </Card>
      ) : (
        <>
          <MetricStrip className="mb-4">
            <Metric label="Stored mentions" value={num(facets.total)} />
            <Metric label="Unread" value={num(facets.unread)} />
            <Metric label="Open negative" value={num(facets.negative_open)} info="Negative mentions that are new or read (not actioned or ignored)." />
            <Metric label="Last fetch" value={settings.lastFetchAt ? timeAgo(settings.lastFetchAt) : "n/a"} sub={"inserted" in settings.lastFetch ? `${settings.lastFetch.inserted} new` : undefined} />
          </MetricStrip>

          <form method="get" className="mb-4 grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface p-3 shadow-card sm:grid-cols-4 lg:grid-cols-[1.4fr_repeat(6,1fr)]">
            <input type="hidden" name="brand" value={brand.id} />
            <Input name="q" defaultValue={filters.q} placeholder="Search text or author" aria-label="Search" className="col-span-2 sm:col-span-4 lg:col-span-1" />
            <Select name="topic" defaultValue={filters.topic ?? ""} aria-label="Topic">
              <option value="">All topics</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
            <Select name="source" defaultValue={filters.source ?? ""} aria-label="Source">
              <option value="">All sources</option>
              {LISTEN_SOURCES.map((s) => (
                <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
              ))}
            </Select>
            <Select name="sentiment" defaultValue={filters.sentiment ?? ""} aria-label="Sentiment">
              <option value="">Any sentiment</option>
              {SENTIMENTS.map((s) => (
                <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
              ))}
            </Select>
            <Select name="intent" defaultValue={filters.intent ?? ""} aria-label="Intent">
              <option value="">Any intent</option>
              {Object.entries(INTENTS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
            <Select name="lang" defaultValue={filters.lang ?? ""} aria-label="Language">
              <option value="">Any language</option>
              {facets.languages.map((l) => (
                <option key={l} value={l}>{languageName(l)}</option>
              ))}
            </Select>
            <Select name="status" defaultValue={filters.status ?? ""} aria-label="Status">
              <option value="">Any status</option>
              <option value="open">Open (new + read)</option>
              <option value="new">New</option>
              <option value="read">Read</option>
              <option value="actioned">Actioned</option>
              <option value="ignored">Ignored</option>
            </Select>
            <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-4 lg:col-span-7">
              <label className="flex items-center gap-1.5 text-[12.5px] text-text-3">
                From <Input type="date" name="from" defaultValue={filters.from} className="h-8 w-38" />
              </label>
              <label className="flex items-center gap-1.5 text-[12.5px] text-text-3">
                To <Input type="date" name="to" defaultValue={filters.to} className="h-8 w-38" />
              </label>
              {facets.tags.length > 0 && (
                <Select name="tag" defaultValue={filters.tag ?? ""} aria-label="Tag" className="w-36">
                  <option value="">Any tag</option>
                  {facets.tags.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
              )}
              <div className="ml-auto flex gap-2">
                {filtered && (
                  <Link href={`/cx/listening?brand=${brand.id}`} className={buttonClass("ghost", "md")}>Reset</Link>
                )}
                <a href={`/api/cx/listening/export?${qs({})}`} className={buttonClass("secondary", "md")}>
                  <Download className="h-4 w-4" /> CSV
                </a>
                <button type="submit" className={buttonClass("primary", "md")}>Apply</button>
              </div>
            </div>
          </form>

          <div className="mb-2 text-[12.5px] text-text-3">
            {num(feed.total)} {feed.total === 1 ? "mention" : "mentions"}
            {filtered ? " match the filters" : ""}
            {pages > 1 ? ` · page ${page} of ${pages}` : ""}
          </div>
          {feed.rows.length ? (
            <MentionsFeed
              brandId={brand.id}
              mentions={feed.rows.map((m) => ({
                id: m.id, topic_name: m.topic_name, topic_kind: m.topic_kind, source: m.source, url: m.url, author: m.author, author_handle: m.author_handle,
                author_followers: m.author_followers, title: m.title, body: m.body.slice(0, 1200), language: m.language, translation: m.translation?.slice(0, 1200) ?? null, published_at: m.published_at,
                sentiment: m.sentiment, intent: m.intent, engagement: m.engagement, status: m.status, tags: m.tags, ticket_id: m.ticket_id, ticket_number: m.ticket_number,
              }))}
            />
          ) : (
            <Card>
              <EmptyState
                icon={<SearchX className="h-5 w-5" />}
                title={filtered ? "No mentions match these filters" : "No mentions yet"}
                description={filtered ? "Try a wider date range or fewer filters." : "The first fetch may still be running. Use Fetch now to collect mentions from the configured sources."}
                action={filtered ? <ButtonLink href={`/cx/listening?brand=${brand.id}`}>Reset filters</ButtonLink> : <JobButton brandId={brand.id} kind="fetch" initialJobId={running} />}
              />
            </Card>
          )}
          {pages > 1 && (
            <nav className="mt-4 flex items-center justify-center gap-2" aria-label="Pagination">
              {page > 1 && <Link className={buttonClass("secondary", "sm")} href={`/cx/listening?${qs({ page: String(page - 1) })}`}>Previous</Link>}
              <span className="text-[12.5px] text-text-3">Page {page} of {pages}</span>
              {page < pages && <Link className={buttonClass("secondary", "sm")} href={`/cx/listening?${qs({ page: String(page + 1) })}`}>Next</Link>}
            </nav>
          )}
        </>
      )}
    </Page>
  );
}
