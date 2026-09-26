import Link from "next/link";
import { statRows, type StatRow } from "@/lib/site-audit/data";
import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { Grid } from "@/components/shell/page";
import { fmtBytes, fmtMs, pathOf } from "@/components/site-audit/ui";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { Bar } from "@/components/ui/progress";
import type { AuditCtx } from "./context";

export function bucket<T>(rows: T[], value: (r: T) => number | null | undefined, edges: { label: string; max: number }[]) {
  const out = edges.map((e) => ({ label: e.label, pages: 0 }));
  for (const r of rows) {
    const v = value(r);
    if (v == null) continue;
    const i = edges.findIndex((e) => v <= e.max);
    out[i === -1 ? edges.length - 1 : i].pages++;
  }
  return out;
}
export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
export const isOk = (r: StatRow) => r.status != null && r.status >= 200 && r.status < 300;
export const isHtmlRow = (r: StatRow) => isOk(r) && r.words != null;

export function statusData(rows: StatRow[]) {
  const c = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, Failed: 0, Blocked: 0 };
  for (const r of rows) {
    if (r.status == null) c.Blocked++;
    else if (r.status === 0) c.Failed++;
    else if (r.status >= 500) c["5xx"]++;
    else if (r.status >= 400) c["4xx"]++;
    else if (r.status >= 300) c["3xx"]++;
    else c["2xx"]++;
  }
  return Object.entries(c).map(([label, pages]) => ({ label, pages }));
}
export function depthData(rows: StatRow[]) {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.status == null) continue;
    const k = r.depth == null ? "Not linked" : r.depth >= 6 ? "6+" : String(r.depth);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  const order = ["0", "1", "2", "3", "4", "5", "6+", "Not linked"];
  return order.filter((k) => map.has(k)).map((k) => ({ label: k, pages: map.get(k)! }));
}
export const LOAD_EDGES = [
  { label: "<250ms", max: 250 },
  { label: "250–500", max: 500 },
  { label: "0.5–1s", max: 1000 },
  { label: "1–2s", max: 2000 },
  { label: "2–3s", max: 3000 },
  { label: ">3s", max: Infinity },
];
export const SIZE_EDGES = [
  { label: "<25K", max: 25_000 },
  { label: "25–50K", max: 50_000 },
  { label: "50–100K", max: 100_000 },
  { label: "100–250K", max: 250_000 },
  { label: "250K–1M", max: 1_000_000 },
  { label: ">1M", max: Infinity },
];
export const INLINK_EDGES = [
  { label: "0", max: 0 },
  { label: "1", max: 1 },
  { label: "2–5", max: 5 },
  { label: "6–10", max: 10 },
  { label: "11–50", max: 50 },
  { label: "51+", max: Infinity },
];

export async function StatisticsView({ ctx }: { ctx: AuditCtx }) {
  const { crawl, href } = ctx;
  if (crawl.details_pruned) return <Callout tone="warning">Statistics need page-level details, which were pruned for this older crawl.</Callout>;
  const rows = await statRows(crawl.id);
  const html = rows.filter(isHtmlRow);
  const ok = rows.filter(isOk);
  const loads = ok.map((r) => r.response_ms).filter((x): x is number => x != null);
  const ttfbs = ok.map((r) => r.ttfb).filter((x): x is number => x != null);
  const sizes = html.map((r) => r.size_bytes).filter((x): x is number => x != null);
  const words = html.map((r) => r.words ?? 0);
  const types = new Map<string, number>();
  for (const r of rows) if (r.status != null && r.status !== 0 && !(r.status >= 300 && r.status < 400)) types.set(r.content_type ?? "unknown", (types.get(r.content_type ?? "unknown") ?? 0) + 1);
  const enc = new Map<string, number>();
  for (const r of html) enc.set(r.enc ?? "none", (enc.get(r.enc ?? "none") ?? 0) + 1);
  const ld = new Map<string, number>();
  for (const r of html) for (const t of r.ld_types ?? []) ld.set(t, (ld.get(t) ?? 0) + 1);
  const n = html.length || 1;
  const coverage = [
    { label: "Title tag", v: html.filter((r) => r.title).length },
    { label: "JSON-LD", v: html.filter((r) => (r.ld_count ?? 0) > 0).length },
    { label: "Microdata", v: html.filter((r) => (r.microdata ?? 0) > 0).length },
    { label: "Open Graph", v: html.filter((r) => r.has_og).length },
    { label: "Twitter Card", v: html.filter((r) => r.has_tw).length },
    { label: "hreflang", v: html.filter((r) => (r.hreflang ?? 0) > 0).length },
    { label: "lang attribute", v: html.filter((r) => r.lang).length },
    { label: "Canonical tag", v: html.filter((r) => r.canonical).length },
  ];
  const indexability = [
    { label: "Indexable", value: rows.filter((r) => r.indexable).length, color: "var(--good)" },
    { label: "noindex", value: html.filter((r) => r.noindex).length, color: "var(--warning)" },
    { label: "Canonicalized", value: html.filter((r) => !r.noindex && r.canonical && r.canonical !== r.url).length, color: "var(--series-7)" },
    { label: "Redirect", value: rows.filter((r) => r.status != null && r.status >= 300 && r.status < 400).length, color: "var(--series-1)" },
    { label: "Broken", value: rows.filter((r) => r.status != null && (r.status === 0 || r.status >= 400)).length, color: "var(--critical)" },
    { label: "Blocked", value: rows.filter((r) => r.status == null).length, color: "var(--text-3)" },
  ].filter((x) => x.value > 0);
  const slow = [...ok].sort((a, b) => (b.response_ms ?? 0) - (a.response_ms ?? 0)).slice(0, 6);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const pageLink = (r: StatRow) => (
    <Link key="u" href={href({ tab: "pages", page: r.id })} scroll={false} className="block max-w-[190px] truncate text-link hover:underline sm:max-w-[240px] xl:max-w-[210px]" title={r.url}>
      {pathOf(r.url)}
    </Link>
  );

  return (
    <>
      <Card className="mb-4">
        <MetricStrip>
          <Metric label="URLs crawled" value={rows.filter((r) => r.status != null).length.toLocaleString()} sub={`${html.length} HTML pages`} />
          <Metric label="Median load time" value={fmtMs(median(loads))} sub={`Avg ${fmtMs(avg(loads))}`} />
          <Metric label="Median TTFB" value={fmtMs(median(ttfbs))} sub="Time to first byte" />
          <Metric label="Median HTML size" value={fmtBytes(median(sizes))} sub={`Largest ${fmtBytes(Math.max(0, ...sizes))}`} />
          <Metric label="Median word count" value={(median(words) ?? 0).toLocaleString()} sub={`${html.filter((r) => (r.words ?? 0) < 200).length} pages under 200 words`} />
          <Metric label="Internal links / page" value={(avg(html.map((r) => r.int_links ?? 0)) ?? 0).toFixed(0)} sub={`${(avg(html.map((r) => r.ext_links ?? 0)) ?? 0).toFixed(0)} external`} />
        </MetricStrip>
      </Card>
      <Grid cols={3} className="mb-4">
        <Card>
          <CardHeader title="HTTP status codes" description="All crawled URLs" href={href({ tab: "pages" })} />
          <CardBody>
            <BarChart data={statusData(rows)} xKey="label" series={[{ key: "pages", label: "URLs" }]} valueLabels height={200} yFormat="number" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Crawl depth" description="Clicks from the start page" info="Pages more than 3 clicks deep are crawled less often by search engines." />
          <CardBody>
            <BarChart data={depthData(rows)} xKey="label" series={[{ key: "pages", label: "Pages" }]} valueLabels height={200} yFormat="number" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Indexability" description="Why pages can or can't be indexed" />
          <CardBody>
            <DonutChart data={indexability} size={130} format="number" centerValue={String(rows.filter((r) => r.indexable).length)} centerLabel="indexable" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Load time" description="Time to download the HTML (2xx pages)" />
          <CardBody>
            <BarChart data={bucket(ok, (r) => r.response_ms, LOAD_EDGES)} xKey="label" series={[{ key: "pages", label: "Pages" }]} valueLabels height={200} yFormat="number" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="HTML size" description="Uncompressed document size" />
          <CardBody>
            <BarChart data={bucket(html, (r) => r.size_bytes, SIZE_EDGES)} xKey="label" series={[{ key: "pages", label: "Pages" }]} valueLabels height={200} yFormat="number" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Incoming internal links" description="Unique crawled pages linking to each page" />
          <CardBody>
            <BarChart data={bucket(html, (r) => r.inlinks, INLINK_EDGES)} xKey="label" series={[{ key: "pages", label: "Pages" }]} valueLabels height={200} yFormat="number" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Word count" description="Visible words per HTML page (bucket lower bounds)" />
          <CardBody>
            <BarChart
              data={bucket(html, (r) => r.words, [
                { label: "<100", max: 99 },
                { label: "100+", max: 299 },
                { label: "300+", max: 599 },
                { label: "600+", max: 999 },
                { label: "1k+", max: 1999 },
                { label: "2k+", max: Infinity },
              ])}
              xKey="label"
              series={[{ key: "pages", label: "Pages" }]}
              valueLabels
              height={200}
              yFormat="number"
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Content types" description="Non-redirect responses" />
          <CardBody>
            <DonutChart data={[...types.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} size={120} format="number" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Compression" description="Content-Encoding of HTML pages" />
          <CardBody>
            <DonutChart
              data={[...enc.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label: label === "none" ? "Uncompressed" : label === "br" ? "Brotli" : label, value }))}
              size={120}
              format="number"
            />
          </CardBody>
        </Card>
      </Grid>
      <Grid cols={3} className="mb-4">
        <Card>
          <CardHeader title="Markup coverage" description="Share of HTML pages with each element" />
          <CardBody>
            <ul className="space-y-2">
              {coverage.map((c) => (
                <li key={c.label} className="grid grid-cols-[110px_1fr_48px] items-center gap-2 text-[12.5px]">
                  <span className="truncate text-text-2">{c.label}</span>
                  <Bar value={(c.v / n) * 100} />
                  <span className="tabular text-right text-text">{Math.round((c.v / n) * 100)}%</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Structured data types" description="schema.org @type found in JSON-LD" />
          <CardBody>
            <MiniTable
              empty="No JSON-LD found on the crawled pages."
              columns={[{ header: "Type" }, { header: "Pages", align: "right" }]}
              rows={[...ld.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([t, v]) => [t, v])}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Slowest pages" description="By HTML download time" />
          <CardBody>
            <MiniTable columns={[{ header: "Page" }, { header: "Load", align: "right" }, { header: "TTFB", align: "right" }]} rows={slow.map((r) => [pageLink(r), fmtMs(r.response_ms), fmtMs(r.ttfb)])} />
          </CardBody>
        </Card>
      </Grid>
    </>
  );
}
