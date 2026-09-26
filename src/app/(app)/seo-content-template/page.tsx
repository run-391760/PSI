import { Download, FileText, Link2, ListOrdered } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requirePageUser } from "@/lib/auth";
import { keywordRegex } from "@/lib/content/text";
import { MAX_TEMPLATE_KEYWORDS, buildTemplate, parseTemplateKeywords } from "@/lib/content/template";
import { database } from "@/lib/domain";
import { compact, displayUrl, num } from "@/lib/format";
import { OpenInWritingAssistant } from "@/components/content/template/open-in-wa";
import { AsBadge, DomainLink, IntentBadges, KdBadge, KeywordLink } from "@/components/seo/badges";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
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
  await requirePageUser();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const db = database(typeof sp.db === "string" ? sp.db : "US").code;
  const keywords = parseTemplateKeywords(q);
  const ignored = q.split(/[,\n;]+/).filter((s) => s.trim()).length - keywords.length;

  if (!keywords.length)
    return (
      <Page>
        <PageHeader breadcrumbs={BREADCRUMBS} title="SEO Content Template" description="A content brief built from the top-10 results for your keywords: related words, length and readability targets, backlink sources and title/meta/H1 recommendations.">
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

  const { data: t, source, fetchedAt } = buildTemplate(keywords, db);
  const info = database(db);
  const qs = `q=${encodeURIComponent(keywords.join(", "))}&db=${db}`;
  const primaryMentions = t.targets.mentions[0]?.avg ?? 0;
  const maxWords = Math.max(...t.rivals.map((r) => r.words), t.targets.words);

  return (
    <Page>
      <PageHeader
        breadcrumbs={BREADCRUMBS}
        title="SEO Content Template:"
        subject={keywords.join(", ")}
        meta={
          <>
            <DataSourceBadge source={source} fetchedAt={fetchedAt} />
            <Badge>
              {info.flag} {info.name}
            </Badge>
            {t.metrics.map((m) => (
              <Badge key={m.keyword} tone="brand">
                {m.keyword} · {compact(m.volume)}/mo
              </Badge>
            ))}
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
        <ToolSearch placeholder={`Enter up to ${MAX_TEMPLATE_KEYWORDS} keywords, separated by commas`} buttonLabel="Create template" defaultValue={keywords.join(", ")} />
      </PageHeader>
      {ignored > 0 && (
        <Callout tone="warning" className="mb-4">
          {ignored} entr{ignored === 1 ? "y was" : "ies were"} ignored: duplicates, entries shorter than 2 characters, or beyond the limit of {MAX_TEMPLATE_KEYWORDS} keywords.
        </Callout>
      )}

      <Card className="mb-4">
        <MetricStrip>
          <Metric label="Recommended text length" value={`${num(t.targets.words)} words`} sub={`Top-10 range ${num(t.targets.wordsRange[0])}–${num(t.targets.wordsRange[1])}`} info="Average length of the main content on the top-10 pages." />
          <Metric label="Readability target" value={t.targets.readability} sub={`Flesch · ${t.targets.readabilityLabel} (${t.targets.audience})`} info="Flesch reading ease, 0–100: higher is easier to read." />
          <Metric label="Keyword mentions" value={`~${primaryMentions}×`} sub={`“${keywords[0]}” on an average top-10 page`} />
          <Metric label="Related words" value={t.semantic.length} sub="Semantically related terms to cover" />
          <Metric label="Backlink sources" value={t.backlinkSources.length} sub="Domains linking to several rivals" />
        </MetricStrip>
      </Card>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader title="Key recommendations" description={`Based on the top 10 Google results for ${keywords.length > 1 ? "your keywords" : `“${keywords[0]}”`} in ${info.name}`} />
          <Section icon={<FileText className="h-3.5 w-3.5" />} title="Semantically related words" info="use them in your text">
            <ul className="flex flex-wrap gap-1.5">
              {t.semantic.map((s) => (
                <li key={s.term} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[12.5px] text-text" title={`Used by ${s.rivals} of the top-10 pages`}>
                  {s.term}
                  <span className="tabular text-[11px] text-text-3">{s.rivals}/10</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section icon={<Link2 className="h-3.5 w-3.5" />} title="Backlinks" info="try to get links from these domains">
            {t.backlinkSources.length ? (
              <MiniTable
                columns={[{ header: "Domain" }, { header: "AS", align: "right" }, { header: "Links to rivals", align: "right" }]}
                rows={t.backlinkSources.slice(0, 8).map((b) => [<DomainLink key="d" domain={b.domain} db={db} />, <AsBadge key="a" score={b.authorityScore} />, `${b.rivals} of 10`])}
              />
            ) : (
              <p className="text-[13px] text-text-3">No domain links to more than one rival.</p>
            )}
          </Section>
          <Section icon={<ListOrdered className="h-3.5 w-3.5" />} title="Readability and length">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
                  <span className="text-text-2">Flesch reading ease</span>
                  <span className="font-semibold text-text">{t.targets.readability}</span>
                </div>
                <div className="relative h-2 rounded-full bg-[linear-gradient(90deg,var(--critical),var(--serious),var(--warning),var(--good))]">
                  <span className="absolute -top-1 h-4 w-1 -translate-x-1/2 rounded bg-text" style={{ left: `${t.targets.readability}%` }} aria-hidden />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-text-3">
                  <span>Very difficult</span>
                  <span>Very easy</span>
                </div>
                <p className="mt-1.5 text-[12.5px] text-text-2">
                  Aim for “{t.targets.readabilityLabel.toLowerCase()}” text readable by a {t.targets.audience.toLowerCase()} audience.
                </p>
              </div>
              <div>
                <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
                  <span className="text-text-2">Text length</span>
                  <span className="font-semibold text-text">{num(t.targets.words)} words</span>
                </div>
                <div className="relative h-2 rounded-full bg-surface-3">
                  <span className="absolute h-2 rounded-full bg-series-1/35" style={{ left: `${(t.targets.wordsRange[0] / maxWords) * 100}%`, width: `${((t.targets.wordsRange[1] - t.targets.wordsRange[0]) / maxWords) * 100}%` }} aria-hidden />
                  <span className="absolute -top-1 h-4 w-1 -translate-x-1/2 rounded bg-text" style={{ left: `${(t.targets.words / maxWords) * 100}%` }} aria-hidden />
                </div>
                <p className="mt-2.5 text-[12.5px] text-text-2">
                  About {t.targets.h2} H2 sections and {t.targets.images} images{t.targets.video >= 40 ? `; ${t.targets.video}% of rivals embed a video` : ""}.
                </p>
              </div>
            </div>
          </Section>
        </Card>

        <Card>
          <CardHeader title="Title, meta description and H1" />
          <CardBody className="space-y-4">
            <div className="rounded-md border border-border bg-surface-2 p-3">
              <div className="text-[11.5px] text-text-3">SERP preview</div>
              <div className="mt-1 truncate text-[16px] text-link">{t.recommendations.titleExamples[0]}</div>
              <div className="text-[12px] text-good-ink">yourdomain.com › {keywords[0].replace(/\s+/g, "-")}</div>
              <div className="mt-0.5 line-clamp-2 text-[12.5px] text-text-2">{t.recommendations.metaExample}</div>
            </div>
            {(
              [
                ["Title tag", t.recommendations.title, t.recommendations.titleExamples],
                ["Meta description", t.recommendations.meta, [t.recommendations.metaExample]],
                ["H1", t.recommendations.h1, [t.recommendations.h1Example]],
              ] as [string, string[], string[]][]
            ).map(([label, tips, examples]) => (
              <div key={label}>
                <div className="mb-1 text-[13px] font-semibold">{label}</div>
                <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-text-2">
                  {tips.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
                <div className="mt-1.5 space-y-1">
                  {examples.map((e) => (
                    <div key={e} className="rounded border border-dashed border-border-strong px-2 py-1 text-[12.5px] text-text">
                      <span className="mr-1.5 text-[11px] text-text-3 uppercase">Example</span>
                      {e}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </Grid>

      <Card className="mb-4">
        <CardHeader title="How your rivals use your keywords" description="Sample sentences from the top-ranking pages (demo data)" />
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

      <Card className="mb-4">
        <CardHeader title="Top 10 rivals" description="The pages this brief is based on" href={`/keyword-overview?q=${encodeURIComponent(keywords[0])}&db=${db}`} />
        <CardBody>
          <MiniTable
            columns={[{ header: "#" }, { header: "Page" }, { header: "Words", align: "right" }, { header: "Readability", align: "right" }, { header: "Mentions", align: "right" }, { header: "Ref. domains", align: "right" }]}
            rows={t.rivals.map((r) => [
              r.position,
              <div key="p" className="max-w-[520px] min-w-[200px]">
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="block truncate text-link hover:underline" title={r.title}>
                  {r.title}
                </a>
                <span className="block truncate text-[11.5px] text-text-3">{displayUrl(r.url)}</span>
              </div>,
              <div key="w" className="flex items-center justify-end gap-2">
                <Bar value={r.words} max={maxWords} className="hidden w-14 sm:block" />
                <span>{num(r.words)}</span>
              </div>,
              r.readability,
              r.mentions,
              compact(r.refDomains),
            ])}
          />
        </CardBody>
      </Card>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Related keywords to cover" description="Variations searchers also use" />
          <CardBody>
            <MiniTable
              columns={[{ header: "Keyword" }, { header: "Intent" }, { header: "Volume", align: "right" }, { header: "KD %", align: "right" }]}
              rows={t.related.slice(0, 10).map((r) => [<KeywordLink key="k" keyword={r.keyword} db={db} />, <IntentBadges key="i" intents={r.intents} />, compact(r.volume), <KdBadge key="kd" kd={r.kd} />])}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Suggested outline" description="Questions and subtopics to answer with H2 sections" />
          <CardBody>
            <ol className="space-y-1.5 text-[13px]">
              {t.outline.map((o, i) => (
                <li key={o} className="flex gap-2.5">
                  <span className="tabular flex h-5 w-5 shrink-0 items-center justify-center rounded bg-surface-3 text-[11px] text-text-2">{i + 1}</span>
                  <span className="text-text">{o}</span>
                </li>
              ))}
            </ol>
            {t.questions.length > 0 && (
              <div className="mt-4 border-t border-border pt-3">
                <div className="mb-1.5 text-[12.5px] font-medium text-text-2">Questions people search</div>
                <ul className="flex flex-wrap gap-1.5">
                  {t.questions.map((x) => (
                    <li key={x.keyword}>
                      <KeywordLink keyword={x.keyword} db={db} className="rounded-md border border-border px-2 py-0.5 text-[12.5px]" />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
      </Grid>
      {source === "demo" && <DemoNotice className="mt-6" />}
    </Page>
  );
}
