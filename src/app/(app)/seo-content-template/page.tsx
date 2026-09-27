import { Download, FileText, Link2, ListOrdered } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requirePageUser } from "@/lib/auth";
import { liveEnabled } from "@/lib/providers/source";
import { NeedsData } from "@/components/seo/needs-data";
import { SerpFeatureIcons } from "@/components/seo/badges";
import { keywordRegex } from "@/lib/content/text";
import { MAX_TEMPLATE_KEYWORDS, buildTemplate, cap, parseTemplateKeywords } from "@/lib/content/template";
import { database } from "@/lib/domain";
import { displayUrl, num } from "@/lib/format";
import { OpenInWritingAssistant } from "@/components/content/template/open-in-wa";
import { DomainLink, KeywordLink } from "@/components/seo/badges";
import { DataSourceBadge } from "@/components/seo/source-badge";
import { ToolSearch } from "@/components/seo/tool-search";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { Bar } from "@/components/ui/progress";

export const metadata: Metadata = { title: "SEO Content Template" };

const EXAMPLES: [string, string][] = [
  ["running shoes", "US"],
  ["crm software, crm for small business", "US"],
  ["mba colleges", "IN"],
  ["how to lose weight fast", "US"],
  ["best coffee maker", "GB"],
];
const BREADCRUMBS = [{ label: "On page & tech SEO" }, { label: "SEO Content Template", href: "/seo-content-template" }];

function highlight(text: string, keyword: string): ReactNode[] {
  const re = keywordRegex(keyword);
  if (!re) return [text];
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(
      <mark key={m.index} className="rounded bg-brand-soft px-0.5 font-medium text-brand-ink">
        {m[0]}
      </mark>,
    );
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

function Section({ icon, title, children, info }: { icon: ReactNode; title: string; children: ReactNode; info?: string }) {
  return (
    <section className="border-t border-border px-4 py-4 first:border-t-0">
      <h3 className="mb-2.5 flex items-center gap-2 text-[13.5px] font-semibold text-text">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-soft text-brand-ink">{icon}</span>
        {title}
        {info && <span className="text-[12px] font-normal text-text-3">· {info}</span>}
      </h3>
      {children}
    </section>
  );
}

export default async function SeoContentTemplatePage({ searchParams }: PageProps<"/seo-content-template">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const db = database(typeof sp.db === "string" ? sp.db : "US").code;
  const keywords = parseTemplateKeywords(q);
  const ignored = q.split(/[,\n;]+/).filter((s) => s.trim()).length - keywords.length;

  if (!keywords.length)
    return (
      <Page>
        <PageHeader breadcrumbs={BREADCRUMBS} title="SEO Content Template" description="A content brief built from the live Google top 10 for your keywords: words the top pages use, length and readability targets, questions to answer and title/meta/H1 recommendations.">
          <ToolSearch placeholder={`Enter up to ${MAX_TEMPLATE_KEYWORDS} keywords, separated by commas`} buttonLabel="Create template" />
        </PageHeader>
        {q && <Callout tone="warning" className="mb-4">Enter at least one keyword (up to 100 characters each).</Callout>}
        <Card>
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title="Create an SEO-friendly content brief"
            description="Enter the keywords you want a page to rank for. Try an example:"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {EXAMPLES.map(([e, d]) => (
                  <ButtonLink key={e} href={`/seo-content-template?q=${encodeURIComponent(e)}&db=${d}`} size="sm">
                    {e} <span className="text-text-3">{database(d).flag}</span>
                  </ButtonLink>
                ))}
              </div>
            }
          />
        </Card>
      </Page>
    );

  const info = database(db);
  const search = <ToolSearch placeholder={`Enter up to ${MAX_TEMPLATE_KEYWORDS} keywords, separated by commas`} buttonLabel="Create template" defaultValue={keywords.join(", ")} />;
  if (!liveEnabled())
    return (
      <Page>
        <PageHeader breadcrumbs={BREADCRUMBS} title="SEO Content Template:" subject={keywords.join(", ")}>
          {search}
        </PageHeader>
        <NeedsData
          providers={["dataforseo"]}
          title="Connect DataForSEO to build content briefs from the real top 10"
          shows={[
            "The live Google top 10 for each keyword, with SERP features",
            "Each result page crawled: length, readability, headings, images",
            "Words and phrases the top pages share",
            "Keyword mentions on an average top page",
            "People-also-ask questions and related searches",
            "Title, meta and H1 guidance, Markdown/HTML export, Writing Assistant hand-off",
          ]}
        />
      </Page>
    );

  const { data: t, source, fetchedAt } = await buildTemplate(user.id, keywords, db);
  const qs = `q=${encodeURIComponent(keywords.join(", "))}&db=${db}`;
  const primaryMentions = t.targets.mentions[0]?.avg ?? null;
  const avg = t.avg;
  const maxWords = Math.max(1, ...t.rivals.map((r) => r.words ?? 0), avg?.words ?? 0);

  return (
    <Page>
      <PageHeader
        breadcrumbs={BREADCRUMBS}
        title="SEO Content Template:"
        subject={keywords.join(", ")}
        meta={
          <>
            <DataSourceBadge source={source} fetchedAt={fetchedAt} />
            <DataSourceBadge source="crawler" note={`${avg?.crawled ?? t.rivals.filter((r) => r.fetched).length} of ${t.rivals.length} result pages crawled`} />
            <Badge>
              {info.flag} {info.name}
            </Badge>
          </>
        }
        actions={
          <>
            <a href={`/api/content/template?${qs}&format=md`} className={buttonClass("secondary")} download>
              <Download className="h-4 w-4" /> .md
            </a>
            <a href={`/api/content/template?${qs}&format=html`} className={buttonClass("secondary")} download>
              <Download className="h-4 w-4" /> .html
            </a>
            <OpenInWritingAssistant q={keywords.join(", ")} db={db} />
          </>
        }
      >
        {search}
      </PageHeader>
      {ignored > 0 && (
        <Callout tone="warning" className="mb-4">
          {ignored} entr{ignored === 1 ? "y was" : "ies were"} ignored: duplicates, entries shorter than 2 characters, or beyond the limit of {MAX_TEMPLATE_KEYWORDS} keywords.
        </Callout>
      )}
      {!avg && (
        <Callout tone="warning" className="mb-4" title="Too few result pages could be crawled">
          Length, readability and structure targets need at least 3 crawlable top-10 pages (some sites block crawlers or render with JavaScript). The SERP-based parts of the brief are still shown.
        </Callout>
      )}

      <Card className="mb-4">
        <MetricStrip>
          <Metric label="Recommended text length" value={avg ? `${num(avg.words)} words` : "n/a"} sub={avg ? `Top-10 range ${num(avg.wordsRange[0])}–${num(avg.wordsRange[1])}` : "Not enough crawled pages"} info="Average length of the main content on the crawled top-10 pages." />
          <Metric label="Readability target" value={avg?.readability ?? "n/a"} sub={avg?.readability != null ? `Flesch · ${t.targets.readabilityLabel} (${t.targets.audience})` : "Not enough crawled pages"} info="Flesch reading ease, 0–100: higher is easier to read." />
          <Metric label="Keyword mentions" value={primaryMentions != null ? `~${primaryMentions}×` : "n/a"} sub={`“${keywords[0]}” on an average top page`} />
          <Metric label="Related words" value={t.semantic.length} sub="Shared by several top pages" />
          <Metric label="Questions" value={t.questions.length} sub="People also ask" />
        </MetricStrip>
      </Card>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader title="Key recommendations" description={`Based on the live Google top 10 for ${keywords.length > 1 ? "your keywords" : `“${keywords[0]}”`} in ${info.name}`} />
          <Section icon={<FileText className="h-3.5 w-3.5" />} title="Words the top pages use" info="cover them in your text">
            {t.semantic.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {t.semantic.map((s) => (
                  <li key={s.term} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[12.5px] text-text" title={`Used by ${s.rivals} of ${s.of} crawled pages`}>
                    {s.term}
                    <span className="tabular text-[11px] text-text-3">
                      {s.rivals}/{s.of}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-text-3">Not enough crawled pages to find shared words.</p>
            )}
          </Section>
          <Section icon={<Link2 className="h-3.5 w-3.5" />} title="SERP features" info="what Google shows for each keyword">
            <ul className="space-y-1.5 text-[13px]">
              {t.serps.map((x) => (
                <li key={x.keyword} className="flex flex-wrap items-center gap-2">
                  <span className="text-text-2">{x.keyword}</span>
                  {x.features.length ? <SerpFeatureIcons features={x.features} /> : <span className="text-text-3">Organic results only</span>}
                </li>
              ))}
            </ul>
          </Section>
          {avg && (
            <Section icon={<ListOrdered className="h-3.5 w-3.5" />} title="Readability and length">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
                    <span className="text-text-2">Flesch reading ease</span>
                    <span className="font-semibold text-text">{avg.readability ?? "n/a"}</span>
                  </div>
                  <div className="relative h-2 rounded-full bg-[linear-gradient(90deg,var(--critical),var(--serious),var(--warning),var(--good))]">
                    {avg.readability != null && <span className="absolute -top-1 h-4 w-1 -translate-x-1/2 rounded bg-text" style={{ left: `${Math.max(0, Math.min(100, avg.readability))}%` }} aria-hidden />}
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-text-3">
                    <span>Very difficult</span>
                    <span>Very easy</span>
                  </div>
                  {t.targets.readabilityLabel && (
                    <p className="mt-1.5 text-[12.5px] text-text-2">
                      Aim for “{t.targets.readabilityLabel.toLowerCase()}” text readable by a {t.targets.audience?.toLowerCase()} audience.
                    </p>
                  )}
                </div>
                <div>
                  <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
                    <span className="text-text-2">Text length</span>
                    <span className="font-semibold text-text">{num(avg.words)} words</span>
                  </div>
                  <div className="relative h-2 rounded-full bg-surface-3">
                    <span className="absolute h-2 rounded-full bg-series-1/35" style={{ left: `${(avg.wordsRange[0] / maxWords) * 100}%`, width: `${((avg.wordsRange[1] - avg.wordsRange[0]) / maxWords) * 100}%` }} aria-hidden />
                    <span className="absolute -top-1 h-4 w-1 -translate-x-1/2 rounded bg-text" style={{ left: `${(avg.words / maxWords) * 100}%` }} aria-hidden />
                  </div>
                  <p className="mt-2.5 text-[12.5px] text-text-2">
                    About {avg.h2} H2 sections and {avg.images} images{avg.video >= 40 ? `; ${avg.video}% of the top pages embed a video` : ""}.
                  </p>
                </div>
              </div>
            </Section>
          )}
        </Card>

        <Card>
          <CardHeader title="Title, meta description and H1" />
          <CardBody className="space-y-4">
            {(
              [
                ["Title tag", t.recommendations.title],
                ["Meta description", t.recommendations.meta],
                ["H1", t.recommendations.h1],
              ] as [string, string[]][]
            ).map(([label, tips]) => (
              <div key={label}>
                <div className="mb-1 text-[13px] font-semibold">{label}</div>
                <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-text-2">
                  {tips.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            ))}
            {t.rivals.length > 0 && (
              <div>
                <div className="mb-1 text-[13px] font-semibold">Titles in the top 3</div>
                <ul className="space-y-1">
                  {t.rivals.slice(0, 3).map((r) => (
                    <li key={r.url} className="rounded border border-dashed border-border-strong px-2 py-1 text-[12.5px] text-text">
                      <span className="mr-1.5 text-[11px] text-text-3">#{r.position}</span>
                      {r.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
      </Grid>

      {t.snippets.length > 0 && (
        <Card className="mb-4">
          <CardHeader title="How the top results describe your keywords" description="Snippets Google shows for the top-ranking pages" />
          <CardBody>
            <ul className="divide-y divide-border">
              {t.snippets.map((s) => (
                <li key={s.url} className="grid gap-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[220px_1fr] sm:gap-4">
                  <div className="flex min-w-0 items-center gap-2 text-[12.5px]">
                    <span className="tabular w-5 shrink-0 text-text-3">#{s.position}</span>
                    <DomainLink domain={s.domain} db={db} />
                  </div>
                  <p className="text-[13px] text-text-2">“{highlight(s.text, s.keyword)}”</p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card className="mb-4">
        <CardHeader title="Top 10" description="The pages this brief is based on (crawled live)" href={`/keyword-overview?q=${encodeURIComponent(keywords[0])}&db=${db}`} />
        <CardBody>
          <MiniTable
            columns={[{ header: "#" }, { header: "Page" }, { header: "Words", align: "right" }, { header: "Readability", align: "right" }, { header: "Mentions", align: "right" }]}
            rows={t.rivals.map((r) => [
              r.position,
              <div key="p" className="max-w-[520px] min-w-[200px]">
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="block truncate text-link hover:underline" title={r.title}>
                  {r.title || displayUrl(r.url)}
                </a>
                <span className="block truncate text-[11.5px] text-text-3">{displayUrl(r.url)}</span>
              </div>,
              r.words == null ? (
                <span key="w" className="text-text-3" title={r.error ?? "Not crawled"}>
                  n/a
                </span>
              ) : (
                <div key="w" className="flex items-center justify-end gap-2">
                  <Bar value={r.words} max={maxWords} className="hidden w-14 sm:block" />
                  <span>{num(r.words)}</span>
                </div>
              ),
              r.readability ?? <span key="r" className="text-text-3">n/a</span>,
              r.mentions ?? <span key="m" className="text-text-3">n/a</span>,
            ])}
          />
        </CardBody>
      </Card>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Related searches" description="Shown by Google for your keywords" />
          <CardBody>
            {t.related.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {t.related.map((r) => (
                  <li key={r}>
                    <KeywordLink keyword={r} db={db} className="rounded-md border border-border px-2 py-0.5 text-[12.5px]" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-text-3">Google showed no related searches.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Suggested outline" description="Questions and subtopics to answer with H2 sections" />
          <CardBody>
            <ol className="space-y-1.5 text-[13px]">
              {t.outline.map((o, i) => (
                <li key={o} className="flex gap-2.5">
                  <span className="tabular flex h-5 w-5 shrink-0 items-center justify-center rounded bg-surface-3 text-[11px] text-text-2">{i + 1}</span>
                  <span className="text-text">{cap(o)}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </Grid>
    </Page>
  );
}
