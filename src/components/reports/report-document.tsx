import { BarChart3 } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { database } from "@/lib/domain";
import { compact, dateLabel, displayUrl, money, pct, timeAgo } from "@/lib/format";
import type { ReportData, SlimFacts } from "@/lib/reports/data";
import { jobKindLabel, JOB_STATUS } from "@/lib/reports/kinds";
import { accentColor, type ReportRecord, templateById } from "@/lib/reports/templates";
import type { ToolSummary } from "@/lib/projects/summary-types";
import { SOURCE_LABELS } from "@/lib/providers/labels";
import { cn } from "@/lib/utils";
import { BarChart } from "@/components/charts/bar-chart";
import { BubbleChart } from "@/components/charts/bubble-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { ToolWidget, widgetTool } from "@/components/dashboard/tool-widget";
import { AsBadge, DomainLink, INTENT_META, IntentBadges, KdBadge, KeywordLink } from "@/components/seo/badges";
import { NeedsData } from "@/components/seo/needs-data";
import { DataSourceBadge } from "@/components/seo/source-badge";
import { Badge } from "@/components/ui/badge";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { Bar, DistributionBar } from "@/components/ui/progress";

/** Print rules for the report page: A4, light tokens, no app chrome, no card chrome, no splits. */
export const REPORT_PRINT_CSS = `
@media print {
  @page { size: A4; margin: 12mm; }
  :root, :root[data-theme="dark"] {
    color-scheme: light;
    --bg:#ffffff; --surface:#ffffff; --surface-2:#f8f9fb; --surface-3:#f0f2f5; --border:#e4e7ec; --border-strong:#cfd4dc;
    --text:#101828; --text-2:#475467; --text-3:#7a8494; --link:#1d64d8; --brand:#5b45e8; --brand-soft:#efedff; --brand-ink:#3a24b8;
    --good-ink:#067306; --good-soft:#e8f6e8; --warning-ink:#8a5a00; --warning-soft:#fff5dc; --serious-ink:#a4461f; --serious-soft:#fdeee7;
    --critical-ink:#b42323; --critical-soft:#fcebeb; --info-soft:#eaf2fd;
    --series-1:#2a78d6; --series-2:#eb6834; --series-3:#1baf7a; --series-4:#eda100; --series-5:#e87ba4; --series-6:#008300; --series-7:#4a3aa7; --series-8:#e34948;
    --chart-grid:#eceef2; --chart-axis:#d0d5dd; --chart-text:#7a8494;
  }
  html, body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .report-screen-pad { padding: 0 !important; max-width: none !important; }
  .report-doc { border: 0 !important; box-shadow: none !important; border-radius: 0 !important; max-width: none !important; margin: 0 !important; }
  .report-doc .report-body { padding: 0 !important; }
  .report-doc .report-cover { padding-left: 0 !important; padding-right: 0 !important; }
  .report-section { break-inside: avoid; page-break-inside: avoid; }
  .report-section.report-break { break-before: page; }
  a { color: inherit !important; text-decoration: none !important; }
  /* Charts keep their on-screen pixel width while printing; the document is capped at 760px on
     screen so they fit the A4 printable width (186mm ≈ 703px). */
}
`;

function Section({ n, title, description, children, className }: { n: number; title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("report-section mt-8 first:mt-0", className)}>
      <div className="mb-3 flex items-baseline gap-2.5 border-b border-border pb-2">
        <span className="tabular text-[12px] font-semibold text-text-3">{String(n).padStart(2, "0")}</span>
        <h2 className="text-[17px] font-semibold tracking-tight text-text">{title}</h2>
        <span className="ml-auto h-1 w-10 rounded-full" style={{ background: "var(--report-accent)" }} aria-hidden />
      </div>
      {description && <p className="-mt-1 mb-3 text-[12.5px] text-text-3">{description}</p>}
      {children}
    </section>
  );
}

const Sub = ({ children }: { children: ReactNode }) => <div className="mb-2 text-[12.5px] font-semibold text-text-2">{children}</div>;
const Panel = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn("rounded-lg border border-border p-3.5", className)}>{children}</div>;
const last12 = <T,>(a: T[]) => a.slice(-12);

// ------------------------------------------------------------------------------ domain sections

function DomainSections({ o, sections, db }: { o: Extract<ReportData, { template: "domain" }>["overview"]; sections: string[]; db: string }) {
  const history = last12(o.history).map((h) => ({
    month: h.month,
    organic: h.organicTraffic,
    paid: h.paidTraffic,
    top3: h.top3,
    top4_10: Math.max(0, h.top10 - h.top3),
    top11_20: Math.max(0, h.top20 - h.top10),
    top21_100: Math.max(0, h.top100 - h.top20),
    referringDomains: h.referringDomains,
  }));
  const intentTotal = o.intents.reduce((s, i) => s + i.keywords, 0) || 1;
  const blocks: Record<string, { title: string; description?: string; body: ReactNode }> = {
    summary: {
      title: "Key metrics",
      body: (
        <Panel className="p-0">
          <MetricStrip>
            <Metric label="Authority Score" value={o.authorityScore} size="sm">
              <Bar value={o.authorityScore} className="mt-1.5 w-20" />
            </Metric>
            <Metric label="Organic traffic" value={compact(o.organic.traffic)} delta={o.organic.trafficChangePct} size="sm" sub={`Cost ${money(o.organic.trafficCost)}`} />
            <Metric label="Organic keywords" value={compact(o.organic.keywords)} delta={o.organic.keywordsChangePct} size="sm" />
            <Metric label="Paid traffic" value={compact(o.paid.traffic)} size="sm" sub={`${compact(o.paid.keywords)} keywords`} />
            <Metric label="Referring domains" value={compact(o.backlinks.referringDomains)} size="sm" sub={`${compact(o.backlinks.total)} backlinks`} />
          </MetricStrip>
        </Panel>
      ),
    },
    traffic: {
      title: "Traffic trend",
      description: "Estimated monthly visits from Google search, last 12 months",
      body: <TrendChart data={history} xKey="month" type="area" height={230} series={[{ key: "organic", label: "Organic traffic" }, { key: "paid", label: "Paid traffic" }]} />,
    },
    positions: {
      title: "Keyword positions",
      body: (
        <div className="grid gap-4 sm:grid-cols-2">
          <Panel>
            <Sub>Keywords by position band</Sub>
            <TrendChart data={history} xKey="month" type="stacked" height={200} series={[{ key: "top3", label: "Top 3" }, { key: "top4_10", label: "4–10" }, { key: "top11_20", label: "11–20" }, { key: "top21_100", label: "21–100" }]} />
          </Panel>
          <Panel>
            <Sub>Position distribution</Sub>
            <BarChart data={o.positionBuckets} xKey="label" series={[{ key: "keywords", label: "Keywords" }]} valueLabels height={218} />
          </Panel>
        </div>
      ),
    },
    keywords: {
      title: "Top organic keywords",
      description: `${compact(o.organic.keywords)} keywords in the top 100`,
      body: (
        <MiniTable
          columns={[{ header: "Keyword" }, { header: "Intent" }, { header: "Pos.", align: "right" }, { header: "Volume", align: "right" }, { header: "KD %", align: "right" }, { header: "CPC", align: "right" }, { header: "Traffic %", align: "right" }]}
          rows={o.topKeywords.slice(0, 10).map((k) => [<KeywordLink key="k" keyword={k.keyword} db={db} />, <IntentBadges key="i" intents={k.intents} />, k.position, compact(k.volume), <KdBadge key="kd" kd={k.kd} />, money(k.cpc), pct(k.trafficPct, 2)])}
        />
      ),
    },
    intents: {
      title: "Search intent & branded traffic",
      body: (
        <div className="grid gap-4 sm:grid-cols-2">
          <Panel>
            <Sub>Keywords by intent</Sub>
            <DistributionBar segments={o.intents.map((i, idx) => ({ label: `${INTENT_META[i.intent].label} · ${compact(i.keywords)} kw`, value: i.keywords, color: `var(--series-${idx + 1})` }))} format={(v) => pct((v / intentTotal) * 100)} />
          </Panel>
          <Panel>
            <Sub>Branded vs non-branded traffic</Sub>
            <DonutChart size={110} data={[{ label: "Non-branded", value: o.brandedTraffic.nonBranded }, { label: "Branded", value: o.brandedTraffic.branded }]} />
          </Panel>
        </div>
      ),
    },
    countries: {
      title: "Traffic by country",
      body: o.countries.length ? (
        <MiniTable
          columns={[{ header: "Country" }, { header: "Share", className: "w-36" }, { header: "Traffic", align: "right" }, { header: "Keywords", align: "right" }]}
          rows={o.countries.slice(0, 8).map((c) => [
            <span key="c">
              {c.flag} {c.name}
            </span>,
            <div key="s" className="flex items-center gap-2">
              <Bar value={c.share} className="w-20" />
              <span className="tabular text-[12px] text-text-2">{c.share}%</span>
            </div>,
            compact(c.traffic),
            compact(c.keywords),
          ])}
        />
      ) : (
        <p className="text-[13px] text-text-3">Country split is not available from the connected provider.</p>
      ),
    },
    competitors: {
      title: "Main organic competitors",
      body: (
        <MiniTable
          columns={[{ header: "Competitor" }, { header: "Com. level", className: "w-32" }, { header: "Common kw", align: "right" }, { header: "SE keywords", align: "right" }, { header: "SE traffic", align: "right" }]}
          rows={o.competitors.slice(0, 10).map((c) => [<DomainLink key="d" domain={c.domain} db={db} />, <Bar key="b" value={c.competitionLevel * 100} className="w-24" />, compact(c.commonKeywords), compact(c.organicKeywords), compact(c.organicTraffic)])}
        />
      ),
    },
    pages: {
      title: "Top pages",
      body: (
        <MiniTable
          columns={[{ header: "URL" }, { header: "Traffic", align: "right" }, { header: "Traffic %", align: "right" }, { header: "Keywords", align: "right" }]}
          rows={o.topPages.slice(0, 8).map((p) => [<span key="u" className="block max-w-[420px] truncate text-text-2">{displayUrl(p.url)}</span>, compact(p.traffic), pct(p.trafficPct, 1), compact(p.keywords)])}
          empty="No page data from the connected provider."
        />
      ),
    },
    paid: {
      title: "Paid search",
      description: `${compact(o.paid.keywords)} paid keywords · ${money(o.paid.trafficCost)} estimated monthly spend`,
      body: (
        <MiniTable
          empty="This domain does not appear to run search ads."
          columns={[{ header: "Keyword" }, { header: "Pos.", align: "right" }, { header: "Volume", align: "right" }, { header: "CPC", align: "right" }, { header: "Traffic", align: "right" }]}
          rows={o.paidKeywords.slice(0, 8).map((k) => [<KeywordLink key="k" keyword={k.keyword} db={db} />, k.position, compact(k.volume), money(k.cpc), compact(k.traffic)])}
        />
      ),
    },
    backlinks: {
      title: "Backlink profile",
      description: `${compact(o.backlinks.referringDomains)} referring domains · ${compact(o.backlinks.total)} backlinks`,
      body: (
        <div className="grid gap-4 sm:grid-cols-2">
          <Panel>
            <Sub>Referring domains, 12 months</Sub>
            <TrendChart data={history} xKey="month" type="area" height={190} series={[{ key: "referringDomains", label: "Referring domains" }]} />
          </Panel>
          <Panel>
            <Sub>Top referring domains</Sub>
            <MiniTable
              columns={[{ header: "Domain" }, { header: "AS", align: "right" }, { header: "Backlinks", align: "right" }]}
              rows={o.referringDomains.slice(0, 6).map((r) => [<DomainLink key="d" domain={r.domain} />, <AsBadge key="a" score={r.authorityScore} />, compact(r.backlinks)])}
              empty="Not available from the connected provider."
            />
          </Panel>
        </div>
      ),
    },
  };
  return <Blocks blocks={blocks} sections={sections} />;
}

function Blocks({ blocks, sections }: { blocks: Record<string, { title: string; description?: string; body: ReactNode }>; sections: string[] }) {
  const list = sections.filter((s) => blocks[s]);
  return (
    <>
      {list.map((id, i) => (
        <Section key={id} n={i + 1} title={blocks[id].title} description={blocks[id].description}>
          {blocks[id].body}
        </Section>
      ))}
    </>
  );
}

// ----------------------------------------------------------------------------- shared helpers

function ComparisonTable({ rows, db, highlight }: { rows: SlimFacts[]; db: string; highlight?: string }) {
  return (
    <MiniTable
      columns={[{ header: "Domain" }, { header: "AS", align: "right" }, { header: "Organic traffic", align: "right" }, { header: "Change", align: "right" }, { header: "Keywords", align: "right" }, { header: "Paid traffic", align: "right" }, { header: "Ref. domains", align: "right" }]}
      rows={rows.map((r) => [
        <span key="d" className="inline-flex items-center gap-1.5">
          <DomainLink domain={r.domain} db={db} className={r.domain === highlight ? "font-semibold" : ""} />
          {r.domain === highlight && <Badge tone="brand" className="h-4 px-1 text-[10px]">You</Badge>}
        </span>,
        <AsBadge key="a" score={r.authorityScore} />,
        compact(r.organicTraffic),
        <span key="c" className={r.trafficChangePct > 0 ? "text-good-ink" : r.trafficChangePct < 0 ? "text-critical-ink" : "text-text-3"}>
          {r.trafficChangePct > 0 ? "+" : ""}
          {r.trafficChangePct.toFixed(1)}%
        </span>,
        compact(r.organicKeywords),
        compact(r.paidTraffic),
        compact(r.referringDomains),
      ])}
    />
  );
}

function trendByDomain(rows: SlimFacts[], key: keyof SlimFacts["history"][number]) {
  const months = last12(rows[0]?.history ?? []).map((h) => h.month);
  return months.map((m) => {
    const point: Record<string, string | number> = { month: m };
    rows.forEach((r, i) => {
      const h = r.history.find((x) => x.month === m);
      point[`d${i}`] = h ? Number(h[key]) : 0;
    });
    return point;
  });
}

/** Report-friendly tool status: configured tools as widgets, the rest listed as "not set up". */
function ToolStatus({ summaries }: { summaries: ToolSummary[] }) {
  const active = summaries.filter((s) => s.state !== "empty");
  const empty = summaries.filter((s) => s.state === "empty");
  return (
    <div className="space-y-3">
      {active.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {active.map((s, i) => (
            <ToolWidget key={`${s.tool}-${i}`} summary={s} />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border-strong px-4 py-5 text-center text-[13px] text-text-3">No tools are set up for this project yet.</p>
      )}
      {empty.length > 0 && (
        <p className="text-[12.5px] text-text-3">
          Not set up yet: <span className="text-text-2">{empty.map((s) => widgetTool(s).label).join(" · ")}</span>
        </p>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------- project sections

function GoogleNeeds({ d }: { d: Extract<ReportData, { template: "project" }> }) {
  if (d.google.state === "error") return <p className="text-[13px] text-critical-ink">Google data could not be loaded: {d.google.message}</p>;
  if (d.google.state === "not-configured") return <NeedsData compact providers={["google"]} />;
  return <p className="rounded-lg border border-dashed border-border-strong px-4 py-5 text-center text-[13px] text-text-3">Link this project to its Search Console site and GA4 property on Organic Traffic Insights to include this section.</p>;
}

function ProjectSections({ d, sections }: { d: Extract<ReportData, { template: "project" }>; sections: string[] }) {
  const o = d.overview;
  const db = database(d.project.country).code;
  const g = d.google.state === "ready" ? d.google.snapshot : null;
  const nv = (v: number | null, f: (x: number) => string = compact) => (v == null ? "n/a" : f(v));
  const dfsNeeds = <NeedsData compact providers={["dataforseo"]} />;
  const audit = [...d.audit].reverse();
  const lastAudit = d.audit[0];
  const blocks: Record<string, { title: string; description?: string; body: ReactNode }> = {
    summary: {
      title: "Project summary",
      body: (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
            {[
              ["Domain", d.project.domain],
              ["Market", `${database(d.project.country).flag} ${database(d.project.country).name}`],
              ["Device", d.project.device === "mobile" ? "Mobile" : "Desktop"],
              ["Created", dateLabel(d.project.created_at)],
              ["Location", d.project.location || "—"],
              ["Brand terms", d.project.brand_terms.length ? d.project.brand_terms.join(", ") : "—"],
              ["Competitors", d.project.competitors.length ? d.project.competitors.join(", ") : "—"],
            ].map(([k, v]) => (
              <div key={k} className={k === "Competitors" ? "col-span-2" : ""}>
                <dt className="text-[11.5px] text-text-3">{k}</dt>
                <dd className="text-text">{v}</dd>
              </div>
            ))}
          </dl>
          {g && (
            <Panel className="p-0">
              <MetricStrip>
                <Metric label={`Clicks (${g.range.days} days)`} value={nv(g.clicks)} delta={g.clicksDelta} size="sm" />
                <Metric label="Impressions" value={nv(g.impressions)} delta={g.impressionsDelta} size="sm" />
                <Metric label="Avg. position" value={nv(g.position, (x) => x.toFixed(1))} delta={g.positionDelta} upIsGood={false} size="sm" />
                <Metric label="Organic sessions" value={nv(g.sessions)} delta={g.sessionsDelta} size="sm" />
              </MetricStrip>
            </Panel>
          )}
        </div>
      ),
    },
    tools: { title: "Tool widgets", description: "Current status of every tool in the project", body: <ToolStatus summaries={d.summaries} /> },
    search: {
      title: "Search performance",
      description: g ? `Search Console clicks and GA4 organic sessions per day, ${g.range.start} → ${g.range.end}` : undefined,
      body: g ? (
        <TrendChart data={g.daily} xKey="date" xFormat="day" height={220} series={[...(g.clicks != null ? [{ key: "clicks", label: "Clicks" }] : []), ...(g.sessions != null ? [{ key: "organic", label: "Organic sessions" }] : [])]} />
      ) : (
        <GoogleNeeds d={d} />
      ),
    },
    queries: {
      title: "Top search queries",
      body: g ? (
        <MiniTable
          empty="Search Console returned no queries for this period."
          columns={[{ header: "Query" }, { header: "Clicks", align: "right" }, { header: "Impressions", align: "right" }, { header: "CTR", align: "right" }, { header: "Position", align: "right" }]}
          rows={g.topQueries.map((q) => [<KeywordLink key="k" keyword={q.query} db={db} />, compact(q.clicks), compact(q.impressions), pct(q.ctr * 100, 1), q.position.toFixed(1)])}
        />
      ) : (
        <GoogleNeeds d={d} />
      ),
    },
    pages: {
      title: "Top landing pages",
      body: g ? (
        <MiniTable
          empty="No page data for this period."
          columns={[{ header: "Page" }, { header: "Clicks", align: "right" }, { header: "Impressions", align: "right" }, { header: "Position", align: "right" }, { header: "Org. sessions", align: "right" }]}
          rows={g.topPages.map((p) => [<span key="u" className="block max-w-[320px] truncate text-text-2">{p.path}</span>, nv(p.clicks), nv(p.impressions), nv(p.position, (x) => x.toFixed(1)), nv(p.sessions)])}
        />
      ) : (
        <GoogleNeeds d={d} />
      ),
    },
    audit: {
      title: "Site Audit",
      description: lastAudit ? `Latest crawl ${lastAudit.finishedAt ? dateLabel(lastAudit.finishedAt) : ""} · ${compact(lastAudit.pages)} pages` : undefined,
      body: lastAudit ? (
        <div className="space-y-3">
          <Panel className="p-0">
            <MetricStrip>
              <Metric label="Site Health" value={lastAudit.health == null ? "n/a" : `${lastAudit.health}%`} size="sm" />
              <Metric label="Errors" value={compact(lastAudit.errors)} size="sm" />
              <Metric label="Warnings" value={compact(lastAudit.warnings)} size="sm" />
              <Metric label="Notices" value={compact(lastAudit.notices)} size="sm" />
            </MetricStrip>
          </Panel>
          {audit.length > 1 && <TrendChart data={audit.map((c) => ({ date: (c.finishedAt ?? "").slice(0, 10), health: c.health }))} xKey="date" xFormat="day" yFormat="number" height={180} series={[{ key: "health", label: "Site Health %" }]} />}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border-strong px-4 py-5 text-center text-[13px] text-text-3">No completed Site Audit crawl for this project yet.</p>
      ),
    },
    rankings: {
      title: "Tracked keyword rankings",
      description: d.rankings?.day ? `Position Tracking · ${dateLabel(d.rankings.day)}${d.rankings.previousDay ? ` vs ${dateLabel(d.rankings.previousDay)}` : ""}` : undefined,
      body: d.rankings?.rows.length ? (
        <MiniTable
          columns={[{ header: "Keyword" }, { header: "Position", align: "right" }, { header: "Change", align: "right" }, { header: "URL" }]}
          rows={d.rankings.rows.slice(0, 20).map((r) => {
            const ch = r.position != null && r.previous != null ? r.previous - r.position : null;
            return [
              <KeywordLink key="k" keyword={r.keyword} db={db} />,
              r.position ?? <span key="p" className="text-text-3">not in top 100</span>,
              ch == null ? <span key="c" className="text-text-3">—</span> : <span key="c" className={ch > 0 ? "text-good-ink" : ch < 0 ? "text-critical-ink" : "text-text-3"}>{ch > 0 ? `+${ch}` : ch}</span>,
              <span key="u" className="block max-w-[240px] truncate text-text-2">{r.url ? displayUrl(r.url) : "—"}</span>,
            ];
          })}
        />
      ) : (
        <p className="rounded-lg border border-dashed border-border-strong px-4 py-5 text-center text-[13px] text-text-3">No real rankings stored yet. Set up Position Tracking for this project.</p>
      ),
    },
    competitors: {
      title: "Competitor benchmark",
      description: d.project.competitors.length ? undefined : "No competitors are set for this project yet.",
      body: !d.competitors.length ? (
        d.available.dataforseo || d.available.demo ? <p className="text-[13px] text-text-3">No competitor data could be loaded.</p> : dfsNeeds
      ) : (
        <div className="space-y-4">
          <ComparisonTable rows={d.competitors} db={db} highlight={d.project.domain} />
          {d.competitors.length > 1 && (
            <Panel>
              <Sub>Organic traffic by domain</Sub>
              <BarChart data={d.competitors.map((c) => ({ domain: c.domain, traffic: c.organicTraffic }))} xKey="domain" series={[{ key: "traffic", label: "Organic traffic" }]} layout="bars" categoryWidth={130} highlight={d.project.domain} valueLabels height={Math.max(120, d.competitors.length * 34)} />
            </Panel>
          )}
        </div>
      ),
    },
    backlinks: {
      title: "Backlink profile",
      body: !o ? (
        dfsNeeds
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Panel>
            <Sub>Summary</Sub>
            <dl className="space-y-1 text-[13px]">
              <div className="flex justify-between"><dt className="text-text-3">Referring domains</dt><dd>{compact(o.backlinks.referringDomains)}</dd></div>
              <div className="flex justify-between"><dt className="text-text-3">Backlinks</dt><dd>{compact(o.backlinks.total)}</dd></div>
              <div className="flex justify-between"><dt className="text-text-3">Referring IPs</dt><dd>{compact(o.backlinks.referringIps)}</dd></div>
            </dl>
          </Panel>
          <Panel>
            <Sub>Top referring domains</Sub>
            <MiniTable columns={[{ header: "Domain" }, { header: "AS", align: "right" }, { header: "Backlinks", align: "right" }]} rows={o.referringDomains.slice(0, 6).map((r) => [<DomainLink key="d" domain={r.domain} />, <AsBadge key="a" score={r.authorityScore} />, compact(r.backlinks)])} empty="Not available from the connected provider." />
          </Panel>
        </div>
      ),
    },
    activity: {
      title: "Recent activity",
      body: (
        <MiniTable
          empty="No background jobs have run for this project yet."
          columns={[{ header: "Job" }, { header: "Status" }, { header: "Message" }, { header: "When", align: "right" }]}
          rows={d.jobs.map((j) => {
            const k = jobKindLabel(j.kind);
            return [
              <span key="k">
                {k.tool} · <span className="text-text-2">{k.action}</span>
              </span>,
              <Badge key="s" tone={JOB_STATUS[j.status]?.tone ?? "neutral"}>
                {JOB_STATUS[j.status]?.label ?? j.status}
              </Badge>,
              <span key="m" className="block max-w-[260px] truncate text-text-2">
                {j.error || j.message || "—"}
              </span>,
              timeAgo(j.created_at),
            ];
          })}
        />
      ),
    },
  };
  return <Blocks blocks={blocks} sections={sections} />;
}

// --------------------------------------------------------------------------- backlink sections

function BacklinkSections({ b, sections }: { b: Extract<ReportData, { template: "backlinks" }>["backlinks"]; sections: string[] }) {
  const f = b.facts;
  const weeks: { week: string; new: number; lost: number }[] = [];
  for (let i = 0; i < b.velocity.length; i += 7) {
    const chunk = b.velocity.slice(i, i + 7);
    if (!chunk.length) continue;
    weeks.push({ week: chunk[0].date.slice(5), new: chunk.reduce((s, x) => s + x.newReferringDomains, 0), lost: chunk.reduce((s, x) => s + x.lostReferringDomains, 0) });
  }
  const growth = f.history.map((h) => ({ month: h.month, referringDomains: h.referringDomains, backlinks: h.backlinks }));
  const toxicTotal = b.toxicity.reduce((s, t) => s + t.value, 0) || 1;
  if (b.toxicity.length < 3) sections = sections.filter((x) => x !== "toxicity");
  const blocks: Record<string, { title: string; description?: string; body: ReactNode }> = {
    summary: {
      title: "Backlink summary",
      body: (
        <Panel className="p-0">
          <MetricStrip>
            <Metric label="Authority Score" value={f.authorityScore} size="sm">
              <Bar value={f.authorityScore} className="mt-1.5 w-20" />
            </Metric>
            <Metric label="Backlinks" value={compact(f.backlinks)} size="sm" />
            <Metric label="Referring domains" value={compact(f.referringDomains)} size="sm" />
            <Metric label="Referring IPs" value={compact(f.referringIps)} size="sm" />
            <Metric label="Follow links" value={pct(f.followRatio * 100, 0)} size="sm" />
          </MetricStrip>
        </Panel>
      ),
    },
    growth: {
      title: "Referring domains growth",
      description: "Last 24 months",
      body: (
        <div className="grid gap-4 sm:grid-cols-2">
          <Panel>
            <Sub>Referring domains</Sub>
            <TrendChart data={growth} xKey="month" type="area" height={190} series={[{ key: "referringDomains", label: "Referring domains" }]} />
          </Panel>
          <Panel>
            <Sub>Backlinks</Sub>
            <TrendChart data={growth} xKey="month" type="area" height={190} series={[{ key: "backlinks", label: "Backlinks", color: "var(--series-2)" }]} />
          </Panel>
        </div>
      ),
    },
    velocity: {
      title: "New & lost referring domains",
      description: "Weekly totals, last 90 days",
      body: <BarChart data={weeks} xKey="week" series={[{ key: "new", label: "New", color: "var(--series-3)" }, { key: "lost", label: "Lost", color: "var(--series-2)" }]} height={220} />,
    },
    referring: {
      title: "Top referring domains",
      body: (
        <MiniTable
          columns={[{ header: "Domain" }, { header: "AS", align: "right" }, { header: "Backlinks", align: "right" }, { header: "Country" }, { header: "First seen", align: "right" }]}
          rows={b.referring.map((r) => [<DomainLink key="d" domain={r.domain} />, <AsBadge key="a" score={r.authorityScore} />, compact(r.backlinks), r.country, r.firstSeen])}
        />
      ),
    },
    anchors: {
      title: "Top anchors",
      body: (
        <MiniTable
          columns={[{ header: "Anchor" }, { header: "Type" }, { header: "Ref. domains", align: "right" }, { header: "Backlinks", align: "right" }]}
          rows={b.anchors.map((a) => [<span key="a" className="block max-w-[320px] truncate">{a.anchor}</span>, <span key="t" className="text-text-2 capitalize">{a.type}</span>, compact(a.referringDomains), compact(a.backlinks)])}
        />
      ),
    },
    types: {
      title: "Link attributes & types",
      body: (
        <div className="grid gap-4 sm:grid-cols-2">
          <Panel>
            <Sub>Follow vs nofollow</Sub>
            <DonutChart
              size={110}
              centerValue={pct(f.followRatio * 100, 0)}
              centerLabel="follow"
              data={[
                { label: "Follow", value: Math.round(f.backlinks * f.followRatio) },
                { label: "Nofollow", value: Math.round(f.backlinks * (1 - f.followRatio)) },
              ]}
            />
          </Panel>
          <Panel>
            <Sub>Backlink types</Sub>
            <DistributionBar segments={b.types.map((t, i) => ({ label: t.type[0].toUpperCase() + t.type.slice(1), value: t.count, color: `var(--series-${i + 1})` }))} format={(v, s) => `${compact(v)} · ${s.toFixed(1)}%`} />
          </Panel>
        </div>
      ),
    },
    toxicity: {
      title: "Toxicity overview",
      description: "Referring domains by toxicity score (0–100)",
      body: (
        <div className="space-y-4">
          <Panel>
            <DistributionBar
              segments={[
                { label: b.toxicity[0].label, value: b.toxicity[0].value, color: "var(--good)" },
                { label: b.toxicity[1].label, value: b.toxicity[1].value, color: "var(--warning)" },
                { label: b.toxicity[2].label, value: b.toxicity[2].value, color: "var(--critical)" },
              ]}
              format={(v) => `${compact(v)} · ${pct((v / toxicTotal) * 100)}`}
            />
          </Panel>
          <Panel>
            <Sub>Most toxic referring domains</Sub>
            <MiniTable
              empty="No potentially toxic domains found."
              columns={[{ header: "Domain" }, { header: "Score", align: "right" }, { header: "Markers" }]}
              rows={b.toxicSample.slice(0, 6).map((t) => [<span key="d" className="block max-w-[220px] truncate">{t.domain}</span>, <span key="s" className="font-medium">{t.score}</span>, <span key="m" className="text-[12px] text-text-2">{t.markers.slice(0, 3).join(" · ")}{t.markers.length > 3 ? ` +${t.markers.length - 3}` : ""}</span>])}
            />
          </Panel>
        </div>
      ),
    },
  };
  return <Blocks blocks={blocks} sections={sections} />;
}

// ------------------------------------------------------------------------- comparison sections

function ComparisonSections({ rows, sections, db }: { rows: SlimFacts[]; sections: string[]; db: string }) {
  const series = rows.map((r, i) => ({ key: `d${i}`, label: r.domain }));
  const blocks: Record<string, { title: string; description?: string; body: ReactNode }> = {
    summary: { title: "Side-by-side metrics", body: <ComparisonTable rows={rows} db={db} highlight={rows[0]?.domain} /> },
    traffic: { title: "Organic traffic trend", description: "Estimated monthly organic visits, last 12 months", body: <TrendChart data={trendByDomain(rows, "organicTraffic")} xKey="month" series={series} height={250} /> },
    keywords: {
      title: "Organic keywords",
      body: (
        <div className="grid gap-4 sm:grid-cols-2">
          <Panel>
            <Sub>Keywords in top 100</Sub>
            <BarChart data={rows.map((r) => ({ domain: r.domain, keywords: r.organicKeywords }))} xKey="domain" series={[{ key: "keywords", label: "Organic keywords" }]} layout="bars" categoryWidth={120} valueLabels highlight={rows[0]?.domain} height={Math.max(130, rows.length * 36)} />
          </Panel>
          <Panel>
            <Sub>Keywords in top 10</Sub>
            <BarChart data={rows.map((r) => ({ domain: r.domain, top10: r.history[r.history.length - 1]?.top10 ?? 0 }))} xKey="domain" series={[{ key: "top10", label: "Top 10 keywords", color: "var(--series-3)" }]} layout="bars" categoryWidth={120} valueLabels highlight={rows[0]?.domain} height={Math.max(130, rows.length * 36)} />
          </Panel>
        </div>
      ),
    },
    backlinks: {
      title: "Referring domains",
      body: (
        <div className="grid gap-4 sm:grid-cols-2">
          <Panel>
            <Sub>Referring domains</Sub>
            <BarChart data={rows.map((r) => ({ domain: r.domain, rd: r.referringDomains }))} xKey="domain" series={[{ key: "rd", label: "Referring domains" }]} layout="bars" categoryWidth={120} valueLabels highlight={rows[0]?.domain} height={Math.max(130, rows.length * 36)} />
          </Panel>
          <Panel>
            <Sub>Referring domains, 12 months</Sub>
            <TrendChart data={trendByDomain(rows, "referringDomains")} xKey="month" series={series} height={200} />
          </Panel>
        </div>
      ),
    },
    positioning: {
      title: "Competitive positioning map",
      description: "Organic keywords vs organic traffic (log scale); bubble size is traffic",
      body: <BubbleChart xLabel="Organic keywords" yLabel="Organic traffic" zLabel="Traffic" log height={300} points={rows.map((r, i) => ({ label: r.domain, x: Math.max(1, r.organicKeywords), y: Math.max(1, r.organicTraffic), z: r.organicTraffic, highlight: i === 0 }))} />,
    },
    authority: { title: "Authority Score", description: "Last 12 months", body: <TrendChart data={trendByDomain(rows, "authorityScore")} xKey="month" series={series} height={220} yFormat="number" /> },
  };
  return <Blocks blocks={blocks} sections={sections} />;
}

// ------------------------------------------------------------------------------------ document

export function ReportDocument({ report, data }: { report: ReportRecord; data: ReportData }) {
  const t = templateById(report.template);
  const info = database(report.db);
  const accent = accentColor(report.branding.accent);
  const subject = report.template === "comparison" ? `${report.subject} vs ${(report.options.competitors ?? []).join(", ")}` : report.subject;
  const source = data.template === "missing" || data.template === "needs" ? null : data.source;
  return (
    <article className="report-doc mx-auto w-full max-w-[760px] overflow-hidden rounded-lg border border-border bg-surface shadow-card" style={{ "--report-accent": accent } as CSSProperties}>
      <div className="h-2" style={{ background: accent }} aria-hidden />
      <header className="report-cover px-6 pt-7 pb-6 sm:px-8">
        <div className="flex items-center gap-2 text-[12px] font-semibold tracking-wider text-text-2 uppercase">
          <span className="flex h-6 w-6 items-center justify-center rounded text-white" style={{ background: accent }}>
            <BarChart3 className="h-3.5 w-3.5" />
          </span>
          {report.branding.company || "SynapseSEO"}
        </div>
        <h1 className="mt-5 text-[28px] leading-tight font-semibold tracking-tight text-text">{report.title}</h1>
        <p className="mt-1 text-[15px] text-text-2">{subject}</p>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-4 text-[12.5px] sm:grid-cols-4">
          <div>
            <dt className="text-text-3">Report</dt>
            <dd className="font-medium text-text">{t?.name ?? report.template}</dd>
          </div>
          <div>
            <dt className="text-text-3">Prepared for</dt>
            <dd className="font-medium text-text">{report.branding.preparedFor || "—"}</dd>
          </div>
          <div>
            <dt className="text-text-3">Database</dt>
            <dd className="font-medium text-text">
              {info.flag} {info.name}
            </dd>
          </div>
          <div>
            <dt className="text-text-3">Date</dt>
            <dd className="font-medium text-text">{dateLabel(new Date())}</dd>
          </div>
        </dl>
        {source && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <DataSourceBadge source={source} fetchedAt={"fetchedAt" in data ? data.fetchedAt : undefined} />
            {source === "demo" && <span className="text-[12px] text-text-3">Synthetic demo numbers, not measured data.</span>}
          </div>
        )}
        {report.branding.intro && <p className="mt-5 rounded-md border-l-[3px] bg-surface-2 px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-line text-text-2" style={{ borderColor: accent }}>{report.branding.intro}</p>}
      </header>
      <div className="report-body border-t border-border px-6 py-7 sm:px-8">
        {data.template === "missing" && <p className="py-10 text-center text-[13px] text-text-3">{data.reason}</p>}
        {data.template === "needs" && <NeedsData providers={data.providers} title="This report needs DataForSEO" shows={["Authority, organic and paid traffic of any domain", "Keywords, competitors and backlink profile", "Charts that refresh every time you open the report"]}>{<p className="mt-2 text-[12.5px] text-text-3">{data.reason}</p>}</NeedsData>}
        {data.template === "domain" && <DomainSections o={data.overview} sections={report.sections} db={info.code} />}
        {data.template === "project" && <ProjectSections d={data} sections={report.sections} />}
        {data.template === "backlinks" && <BacklinkSections b={data.backlinks} sections={report.sections} />}
        {data.template === "comparison" && <ComparisonSections rows={data.domains} sections={report.sections} db={info.code} />}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-6 py-3 text-[11.5px] text-text-3 sm:px-8">
        <span>
          {report.branding.company ? `${report.branding.company} · ` : ""}Generated with SynapseSEO on {dateLabel(new Date())}
        </span>
        {source && <span>Data: {SOURCE_LABELS[source]}</span>}
      </footer>
    </article>
  );
}
