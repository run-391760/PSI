import { Layers, ListTree, Megaphone, Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { database } from "@/lib/domain";
import { compact, money, timeAgo } from "@/lib/format";
import { clusterKeywords, MAX_CLUSTER_KEYWORDS, STRICTNESS, type Cluster, type Strictness } from "@/lib/keywords/cluster";
import { listItems, listLists, MAX_LIST_KEYWORDS } from "@/lib/keywords/lists";
import { parseKeywordInput } from "@/lib/keywords/text";
import type { ListItem } from "@/lib/keywords/types";
import { INTENTS } from "@/lib/seo/types";
import { INTENT_META, KdBadge, KeywordLink, kdBand } from "@/components/seo/badges";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { DistributionBar } from "@/components/ui/progress";
import { TabsNav } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { LinkSegmented } from "@/components/keywords/link-tabs";
import { ImportOnLoad, ListActions, ListKeywordsTable, NewListButton, SeedListForm } from "@/components/keywords/list-manager";
import { MindMap } from "@/components/keywords/mind-map";

export const metadata: Metadata = { title: "Keyword Strategy Builder" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function KeywordStrategyPage({ searchParams }: PageProps<"/keyword-strategy">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const listId = str(sp.list);
  const lists = await listLists(user.id);
  const importRaw = str(sp.import);
  const imported = importRaw ? parseKeywordInput(importRaw, MAX_LIST_KEYWORDS) : null;
  const importDb = database(str(sp.db)).code;
  const list = listId ? lists.find((l) => l.id === listId) : undefined;

  if (!list)
    return (
      <Page>
        <PageHeader
          breadcrumbs={[{ label: "Keyword research" }, { label: "Keyword Strategy Builder", href: "/keyword-strategy" }]}
          title="Keyword Strategy Builder"
          description="Collect keywords in lists, keep their metrics fresh and group them into topic clusters: one pillar page per cluster, subpages for the rest."
          actions={<NewListButton />}
        />
        {listId && <Callout tone="warning" className="mb-4">That keyword list does not exist or belongs to another account.</Callout>}
        {imported && imported.keywords.length > 0 && <ImportOnLoad keywords={imported.keywords} db={importDb} name={str(sp.name)} overflow={imported.overflow} />}
        {importRaw && imported && !imported.keywords.length && <Callout tone="warning" className="mb-4">The import link did not contain any valid keywords.</Callout>}
        <Grid cols={2} className="lg:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHeader title="My keyword lists" description={lists.length ? `${lists.length} list${lists.length === 1 ? "" : "s"}` : undefined} />
            {lists.length ? (
              <CardBody>
                <MiniTable
                  columns={[{ header: "List" }, { header: "Keywords", align: "right" }, { header: "Volume", align: "right" }, { header: "Avg. KD", align: "right" }, { header: "Updated", align: "right" }]}
                  rows={lists.map((l) => [
                    <Link key="n" href={`/keyword-strategy?list=${l.id}`} className="font-medium text-link hover:underline">
                      {database(l.db).flag} {l.name}
                    </Link>,
                    l.keywords.toLocaleString(),
                    compact(l.volume),
                    l.avgKd == null ? "n/a" : <KdBadge key="kd" kd={l.avgKd} />,
                    <span key="u" className="text-text-3">
                      {timeAgo(l.updated_at)}
                    </span>,
                  ])}
                />
              </CardBody>
            ) : (
              <EmptyState
                icon={<ListTree className="h-5 w-5" />}
                title="No keyword lists yet"
                description="Create a list, paste keywords or upload a CSV, or build one from a seed keyword. You can also add keywords from Keyword Overview and the Keyword Magic Tool."
                action={<NewListButton variant="secondary" label="Create a list" />}
              />
            )}
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title="Start from a seed keyword" description="We take the top ideas from the Keyword Magic Tool and cluster them for you." />
              <CardBody>
                <SeedListForm />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="How clustering works" />
              <CardBody>
                <ol className="space-y-2 text-[12.5px] text-text-2">
                  <li className="flex gap-2">
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand-ink">1</span>
                    We look at the Google top 10 for every keyword in the list.
                  </li>
                  <li className="flex gap-2">
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand-ink">2</span>
                    Keywords whose results share 3+ URLs are served by the same page, so they form a cluster.
                  </li>
                  <li className="flex gap-2">
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand-ink">3</span>
                    The highest-volume keyword names the cluster; the biggest clusters become pillar pages.
                  </li>
                </ol>
              </CardBody>
            </Card>
          </div>
        </Grid>
      </Page>
    );

  const items = await listItems(user.id, list.id);
  const view = ["clusters", "map"].includes(str(sp.view)) ? str(sp.view) : "keywords";
  const strict: Strictness = STRICTNESS.some((s) => s.id === sp.strict) ? (sp.strict as Strictness) : "medium";
  const clusters = items.length ? clusterKeywords(items, list.db, strict) : [];
  const info = database(list.db);
  const sources = [...new Set(items.map((i) => i.source))];
  const cpcs = items.filter((i) => i.cpc != null);
  const newest = items.reduce((t, i) => (i.metricsAt > t ? i.metricsAt : t), "");
  const trackKeywords = trackable(items);
  const base = `/keyword-strategy?list=${list.id}`;

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "Keyword research" }, { label: "Keyword Strategy Builder", href: "/keyword-strategy" }, { label: list.name }]}
        title="Keyword Strategy Builder:"
        subject={list.name}
        meta={
          <>
            {(sources.length ? sources : ["demo"]).map((s) => (
              <DataSourceBadge key={s} source={s === "dataforseo" ? "dataforseo" : "demo"} fetchedAt={newest || undefined} />
            ))}
            <Badge>
              {info.flag} {info.name}
            </Badge>
            <Badge tone="brand">{items.length.toLocaleString()} keywords</Badge>
          </>
        }
        actions={
          <>
            <ListActions listId={list.id} name={list.name} />
            <ButtonLink href={`/position-tracking?import=${encodeURIComponent(trackKeywords.join(","))}`} variant="secondary" title={trackKeywords.length < items.length ? `The top ${trackKeywords.length} keywords by volume are sent` : undefined}>
              <Target className="h-4 w-4" /> Track in Position Tracking
            </ButtonLink>
            <ButtonLink href={`/ppc-keyword-tool?import=${encodeURIComponent(trackKeywords.join(","))}&db=${list.db}&name=${encodeURIComponent(list.name)}`} variant="secondary" title="Plan a Google Ads campaign from this list">
              <Megaphone className="h-4 w-4" /> Plan PPC
            </ButtonLink>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <Card>
            <CardHeader title="Lists" actions={<NewListButton variant="secondary" label="New" />} className="items-center" />
            <ul className="scroll-thin max-h-[560px] overflow-y-auto px-1.5 pb-2">
              {lists.map((l) => (
                <li key={l.id}>
                  <Link href={`/keyword-strategy?list=${l.id}${view !== "keywords" ? `&view=${view}` : ""}`} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px]", l.id === list.id ? "bg-brand-soft font-semibold text-brand-ink" : "text-text-2 hover:bg-surface-3 hover:text-text")}>
                    <span className="min-w-0 flex-1 truncate">{l.name}</span>
                    <span className="tabular text-[11.5px] text-text-3">{l.keywords}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </aside>

        <div className="min-w-0">
          <Card className="mb-4">
            <MetricStrip>
              <Metric label="Keywords" value={items.length.toLocaleString()} sub={`of ${MAX_LIST_KEYWORDS.toLocaleString()} max`} />
              <Metric label="Total volume" value={compact(list.volume)} sub={`${info.flag} monthly searches`} />
              <Metric label="Average KD" value={list.avgKd == null ? "n/a" : `${list.avgKd}%`} sub={list.avgKd == null ? undefined : kdBand(list.avgKd).label} />
              <Metric label="Average CPC" value={cpcs.length ? money(cpcs.reduce((s, i) => s + (i.cpc ?? 0), 0) / cpcs.length) : "n/a"} />
              <Metric label="Clusters" value={clusters.filter((c) => c.keywords.length > 1).length} sub={`${clusters.filter((c) => c.keywords.length === 1).length} standalone keywords`} href={`${base}&view=clusters`} />
            </MetricStrip>
          </Card>

          <TabsNav
            param="view"
            className="mb-4"
            items={[
              { href: `${base}&view=keywords`, label: "Keywords", count: items.length.toLocaleString() },
              { href: `${base}&view=clusters`, label: "Clusters", count: clusters.filter((c) => c.keywords.length > 1).length.toLocaleString() },
              { href: `${base}&view=map`, label: "Mind map" },
            ]}
          />

          {view === "keywords" && (
            <>
              {items.length > 0 && <IntentStrip items={items} />}
              <Card>
                <CardHeader title="Keywords" description={newest ? `Metrics updated ${timeAgo(newest)}` : undefined} />
                <ListKeywordsTable listId={list.id} listName={list.name} items={items} db={list.db} />
              </Card>
            </>
          )}

          {view !== "keywords" && items.length === 0 && (
            <Card>
              <EmptyState icon={<Layers className="h-5 w-5" />} title="Add keywords to see clusters" description="Clusters appear as soon as the list has keywords." />
            </Card>
          )}

          {view !== "keywords" && items.length > 0 && (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12.5px] text-text-2">
                  Grouped by overlap of the Google top 10 (demo SERPs) · {STRICTNESS.find((s) => s.id === strict)?.note}
                  {items.length > MAX_CLUSTER_KEYWORDS && ` Only the top ${MAX_CLUSTER_KEYWORDS.toLocaleString()} keywords by volume are clustered.`}
                </p>
                <LinkSegmented items={STRICTNESS.map((s) => ({ href: `${base}&view=${view}${s.id !== "medium" ? `&strict=${s.id}` : ""}`, label: s.label, active: s.id === strict, title: s.note }))} />
              </div>
              {view === "clusters" ? <ClusterCards clusters={clusters} db={list.db} /> : <ClusterMap clusters={clusters} name={list.name} db={list.db} volume={list.volume} />}
            </>
          )}
        </div>
      </div>
      {sources.includes("demo") && <DemoNotice className="mt-6" />}
    </Page>
  );
}

/** Keywords sent to Position Tracking via URL: top by volume, bounded so the link stays short. */
function trackable(items: ListItem[]) {
  const out: string[] = [];
  let len = 0;
  for (const i of items) {
    if (out.length >= 200 || len + i.keyword.length > 5000) break;
    out.push(i.keyword);
    len += i.keyword.length + 1;
  }
  return out;
}

function IntentStrip({ items }: { items: ListItem[] }) {
  const segments = INTENTS.map((i, idx) => ({ label: INTENT_META[i].label, value: items.filter((k) => k.intents[0] === i).length, color: `var(--series-${idx + 1})` }));
  return (
    <Card className="mb-4">
      <CardBody className="pt-3.5">
        <div className="mb-2 text-[12.5px] font-medium text-text-2">Keywords by primary intent</div>
        <DistributionBar segments={segments} showLegend={false} />
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
          {segments.map((s) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
              <span className="text-text-2">{s.label}</span>
              <span className="tabular font-medium text-text">{s.value}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function ClusterCards({ clusters, db }: { clusters: Cluster[]; db: string }) {
  const grouped = clusters.filter((c) => c.keywords.length > 1);
  const single = clusters.filter((c) => c.keywords.length === 1);
  return (
    <>
      {grouped.length === 0 && <Callout className="mb-4">No keywords share enough results to form clusters at this strictness. Try “Loose”.</Callout>}
      <Grid cols={3} className="mb-4">
        {grouped.map((c, i) => (
          <Card key={c.id} className="flex flex-col">
            <CardHeader
              title={
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `var(--series-${(i % 8) + 1})` }} aria-hidden />
                  <KeywordLink keyword={c.pillar} db={db} className="text-text hover:text-link" />
                </span>
              }
              description={i === 0 || c.keywords.length >= 8 ? "Pillar page · one page targets all these keywords" : "Subpage · supports a pillar page"}
              actions={<Badge tone={i === 0 || c.keywords.length >= 8 ? "brand" : "neutral"}>{c.keywords.length} kw</Badge>}
            />
            <CardBody className="flex-1">
              <div className="mb-2 grid grid-cols-2 gap-2 rounded-md bg-surface-2 px-3 py-2">
                <div>
                  <div className="text-[11.5px] text-text-3">Total volume</div>
                  <div className="tabular text-[15px] font-semibold text-text">{compact(c.volume)}</div>
                </div>
                <div>
                  <div className="text-[11.5px] text-text-3">Avg. KD</div>
                  <div className="text-[15px] font-semibold text-text">{c.avgKd == null ? "n/a" : <KdBadge kd={c.avgKd} showLabel />}</div>
                </div>
              </div>
              <ul className="space-y-1">
                {c.keywords.slice(0, 8).map((k) => (
                  <li key={k.keyword} className="flex items-center gap-2 text-[12.5px]">
                    <KeywordLink keyword={k.keyword} db={db} className="min-w-0 flex-1 truncate" />
                    <span className="tabular shrink-0 text-text-3">{k.volume == null ? "n/a" : compact(k.volume)}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
            {c.keywords.length > 8 && <CardFooter className="text-text-3">+{c.keywords.length - 8} more keywords</CardFooter>}
          </Card>
        ))}
      </Grid>
      {single.length > 0 && (
        <Card>
          <CardHeader title="Standalone keywords" description={`${single.length} keywords with a unique SERP; each needs its own page or can be dropped.`} />
          <CardBody>
            <div className="flex flex-wrap gap-1.5">
              {single.slice(0, 120).map((c) => (
                <Link key={c.id} href={`/keyword-overview?q=${encodeURIComponent(c.pillar)}&db=${db}`} className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border px-2.5 text-[12px] text-text-2 hover:border-brand/40 hover:text-link">
                  {c.pillar}
                  <span className="text-text-3">{c.volume ? compact(c.volume) : ""}</span>
                </Link>
              ))}
              {single.length > 120 && <span className="text-[12px] text-text-3">+{single.length - 120} more</span>}
            </div>
          </CardBody>
        </Card>
      )}
    </>
  );
}

function ClusterMap({ clusters, name, db, volume }: { clusters: Cluster[]; name: string; db: string; volume: number }) {
  const grouped = clusters.filter((c) => c.keywords.length > 1).slice(0, 14);
  const standalone = clusters.filter((c) => c.keywords.length === 1);
  const branches = grouped.map((c) => ({
    label: c.pillar,
    sub: `${c.keywords.length} kw · ${compact(c.volume)} vol${c.avgKd != null ? ` · KD ${c.avgKd}%` : ""}`,
    href: `/keyword-overview?q=${encodeURIComponent(c.pillar)}&db=${db}`,
    children: c.keywords.filter((k) => k.keyword !== c.pillar).map((k) => ({ label: k.keyword, sub: k.volume == null ? undefined : compact(k.volume), href: `/keyword-overview?q=${encodeURIComponent(k.keyword)}&db=${db}` })),
  }));
  if (standalone.length)
    branches.push({ label: "Standalone keywords", sub: `${standalone.length} kw`, href: "", children: standalone.map((c) => ({ label: c.pillar, sub: c.volume ? compact(c.volume) : undefined, href: `/keyword-overview?q=${encodeURIComponent(c.pillar)}&db=${db}` })) });
  return (
    <Card>
      <CardHeader title="Topic mind map" description={`${grouped.length} clusters${clusters.filter((c) => c.keywords.length > 1).length > grouped.length ? " (largest 14 shown)" : ""} · click a keyword to open its overview`} />
      <CardBody>
        <MindMap root={name} rootSub={`${compact(volume)} total volume`} branches={branches.map((b) => ({ ...b, href: b.href || undefined }))} maxLeaves={5} />
      </CardBody>
    </Card>
  );
}
