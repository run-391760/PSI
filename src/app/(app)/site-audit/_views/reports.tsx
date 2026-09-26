import Link from "next/link";
import { CHECKS, CWV_THRESHOLDS, SEVERITY_ORDER, THEMES } from "@/lib/site-audit/checks";
import { hreflangRows, issueRows, statRows, type StatRow } from "@/lib/site-audit/data";
import type { PsiMetric } from "@/lib/site-audit/types";
import { cn } from "@/lib/utils";
import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { Grid } from "@/components/shell/page";
import { RemeasureCwvButton } from "@/components/site-audit/crawl-controls";
import { CountDelta, countUnit, fmtBytes, fmtMs, HttpStatus, PassFail, pathOf, SeverityIcon, shortUrl } from "@/components/site-audit/ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { Bar, ScoreRing } from "@/components/ui/progress";
import type { AuditCtx } from "./context";
import { bucket, depthData, INLINK_EDGES, isHtmlRow, isOk, LOAD_EDGES, median, SIZE_EDGES, statusData } from "./statistics";

export async function ReportsView({ ctx }: { ctx: AuditCtx }) {
  const { crawl, previous, href, sp } = ctx;
  const theme = THEMES.find((t) => t.key === sp.theme) ?? THEMES[0];
  const rows = crawl.details_pruned ? [] : await statRows(crawl.id);
  const score = crawl.stats.themes?.[theme.key] ?? null;
  const prevScore = previous?.themes?.[theme.key] ?? null;
  const checks = CHECKS.filter((c) => c.category === theme.category);
  const failing = checks.filter((c) => (crawl.stats.byCheck[c.id] ?? 0) > 0).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (crawl.stats.byCheck[b.id] ?? 0) - (crawl.stats.byCheck[a.id] ?? 0));
  const sev = { error: 0, warning: 0, notice: 0 };
  for (const c of checks) sev[c.severity] += crawl.stats.byCheck[c.id] ?? 0;

  return (
    <>
      <nav className="scroll-thin mb-4 flex gap-2 overflow-x-auto pb-1" aria-label="Thematic reports">
        {THEMES.map((t) => {
          const v = crawl.stats.themes?.[t.key] ?? null;
          const active = t.key === theme.key;
          return (
            <Link
              key={t.key}
              href={href({ tab: "reports", theme: t.key })}
              className={cn("flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors", active ? "border-brand bg-brand-soft text-brand-ink" : "border-border-strong bg-surface text-text-2 hover:text-text")}
              aria-current={active ? "page" : undefined}
            >
              {t.label}
              <span className="tabular rounded bg-surface-3 px-1.5 text-[11px] text-text-2">{v == null ? "n/a" : `${v}%`}</span>
            </Link>
          );
        })}
      </nav>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1fr_1.6fr]">
        <Card>
          <CardBody className="flex flex-wrap items-center gap-5 pt-4">
            <ScoreRing value={score ?? 0} size={112} stroke={11} label={score == null ? "n/a" : `${score}%`} color={score == null ? "var(--surface-3)" : undefined} />
            <div className="min-w-0 flex-1">
              <h2 className="text-[17px] font-semibold text-text">{theme.label}</h2>
              <p className="mt-0.5 text-[12.5px] text-text-3">{theme.description}</p>
              {score != null && prevScore != null && (
                <div className="mt-1.5 text-[12.5px]">
                  <CountDelta delta={score - prevScore} upIsGood suffix=" pts" showZero /> <span className="text-text-3">vs previous crawl</span>
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone="critical">{sev.error} errors</Badge>
                <Badge tone="warning">{sev.warning} warnings</Badge>
                <Badge tone="info">{sev.notice} notices</Badge>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={`${theme.label} issues`} description={`${checks.length} checks in this category · ${failing.length} found problems`} />
          <CardBody className="px-0 pb-1">
            {failing.length === 0 ? (
              theme.key === "cwv" && !crawl.cwv?.pages.some((p) => p.ok) ? (
                <p className="px-4 pb-4 text-[13px] text-text-3">No Core Web Vitals measurements are available for this crawl, so these {checks.length} checks could not run.</p>
              ) : (
                <p className="px-4 pb-4 text-[13px] text-good-ink">All {checks.length} {theme.label} checks passed.</p>
              )
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {failing.slice(0, 7).map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-2">
                    <SeverityIcon severity={c.severity} />
                    <Link href={href({ tab: "issues", issue: c.id })} className="min-w-0 flex-1 truncate text-[13px] text-text hover:text-link hover:underline">
                      {c.title}
                    </Link>
                    {previous && <CountDelta delta={(crawl.stats.byCheck[c.id] ?? 0) - (previous.byCheck?.[c.id] ?? 0)} />}
                    <span className="tabular w-[76px] shrink-0 text-right text-[12.5px] font-medium text-text">{countUnit(c.scope, c.scope === "page" ? (crawl.stats.pagesByCheck?.[c.id] || crawl.stats.byCheck[c.id] || 0) : (crawl.stats.byCheck[c.id] ?? 0))}</span>
                  </li>
                ))}
                {failing.length > 7 && (
                  <li className="px-4 py-2 text-[12.5px]">
                    <Link href={href({ tab: "issues", category: theme.category })} className="text-link hover:underline">
                      View all {failing.length} →
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </CardBody>
        </Card>
      </Grid>

      {crawl.details_pruned && theme.key !== "cwv" ? (
        <Callout tone="warning">Detailed charts need page-level data, which was pruned for this older crawl.</Callout>
      ) : theme.key === "crawlability" ? (
        <Crawlability ctx={ctx} rows={rows} />
      ) : theme.key === "https" ? (
        <Https ctx={ctx} rows={rows} />
      ) : theme.key === "international" ? (
        <International ctx={ctx} rows={rows} />
      ) : theme.key === "cwv" ? (
        <Cwv ctx={ctx} />
      ) : theme.key === "performance" ? (
        <Performance ctx={ctx} rows={rows} />
      ) : theme.key === "linking" ? (
        <Linking ctx={ctx} rows={rows} />
      ) : (
        <Markup ctx={ctx} rows={rows} />
      )}
    </>
  );
}

const PageLink = ({ ctx, r }: { ctx: AuditCtx; r: { id: number; url: string } }) => (
  <Link href={ctx.href({ tab: "pages", page: r.id })} scroll={false} className="block max-w-[190px] truncate text-link hover:underline sm:max-w-[260px] xl:max-w-[210px]" title={r.url}>
    {hostOf(r.url) === ctx.crawl.site.host ? pathOf(r.url) : shortUrl(r.url)}
  </Link>
);
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
};
const share = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "0%");

/* ------------------------------------------------ Crawlability ------------------------------------------------ */
function Crawlability({ ctx, rows }: { ctx: AuditCtx; rows: StatRow[] }) {
  const { crawl } = ctx;
  const site = crawl.site;
  const fetched = rows.filter((r) => r.status != null);
  const html = rows.filter(isHtmlRow);
  const dup = crawl.stats.pagesByCheck?.["duplicate-content"] ?? 0;
  const waste = [
    { label: "Indexable, unique", value: Math.max(0, rows.filter((r) => r.indexable).length - dup), color: "var(--good)" },
    { label: "Redirects", value: rows.filter((r) => r.status != null && r.status >= 300 && r.status < 400).length, color: "var(--series-1)" },
    { label: "Broken", value: rows.filter((r) => r.status != null && (r.status === 0 || r.status >= 400)).length, color: "var(--critical)" },
    { label: "Non-canonical", value: html.filter((r) => !r.noindex && r.canonical && r.canonical !== r.url).length, color: "var(--series-7)" },
    { label: "noindex", value: html.filter((r) => r.noindex).length, color: "var(--warning)" },
    { label: "Duplicate content", value: dup, color: "var(--series-5)" },
  ].filter((x) => x.value > 0);
  const wasted = fetched.length - (waste.find((w) => w.label === "Indexable, unique")?.value ?? 0);
  const inSm = rows.filter((r) => r.in_sitemap).length;
  const smRows = [
    { label: "In sitemap & crawled", pages: inSm },
    { label: "Crawled, not in sitemap", pages: rows.filter((r) => r.indexable && !r.in_sitemap).length },
    { label: "In sitemap, not crawled", pages: Math.max(0, (site.sitemapUrlCount ?? 0) - inSm) },
  ];
  return (
    <>
      <Grid cols={3} className="mb-4">
        <Card>
          <CardHeader title="Crawl budget use" description={`${share(wasted, fetched.length)} of requests went to pages that can't rank`} info="Redirects, errors, non-canonical, noindex and duplicate pages consume crawl budget without adding indexable content." />
          <CardBody>
            <DonutChart data={waste} size={112} format="number" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="HTTP status codes" />
          <CardBody>
            <BarChart data={statusData(rows)} xKey="label" series={[{ key: "pages", label: "URLs" }]} valueLabels height={190} yFormat="number" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Crawl depth" />
          <CardBody>
            <BarChart data={depthData(rows)} xKey="label" series={[{ key: "pages", label: "Pages" }]} valueLabels height={190} yFormat="number" />
          </CardBody>
        </Card>
      </Grid>
      <Grid cols={3} className="mb-4">
        <Card>
          <CardHeader title="Sitemap vs crawled pages" description={`${(site.sitemapUrlCount ?? 0).toLocaleString()} URLs in the sitemap`} />
          <CardBody>
            <BarChart data={smRows} xKey="label" series={[{ key: "pages", label: "Pages" }]} layout="bars" categoryWidth={150} valueLabels height={150} yFormat="number" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Sitemap files" description={site.sitemaps?.length ? `${site.sitemaps.length} checked` : "None found"} />
          <CardBody>
            <MiniTable
              empty="No sitemap files."
              columns={[{ header: "File" }, { header: "Type" }, { header: "URLs", align: "right" }, { header: "Status", align: "right" }]}
              rows={(site.sitemaps ?? []).slice(0, 8).map((f) => [
                <div key="f" className="max-w-[220px] min-w-0">
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="block truncate text-link hover:underline" title={f.url}>
                    {pathOf(f.url)}
                  </a>
                  {f.errors[0] && <div className="truncate text-[11.5px] text-critical-ink" title={f.errors.join(" · ")}>{f.errors[0]}</div>}
                </div>,
                f.kind === "index" ? "Index" : f.kind === "urlset" ? "URL set" : f.kind === "invalid" ? "Invalid" : "Missing",
                f.urls.toLocaleString(),
                <HttpStatus key="s" status={f.status} />,
              ])}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="robots.txt" description={site.robots?.found ? `${site.robots.bytes} bytes${site.robots.crawlDelay ? ` · Crawl-delay ${site.robots.crawlDelay}s` : ""}` : (site.robots?.error ?? `HTTP ${site.robots?.status ?? "n/a"}`)} />
          <CardBody>
            {site.robots?.excerpt ? (
              <pre className="scroll-thin max-h-48 overflow-auto rounded-md bg-surface-2 p-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-text-2">{site.robots.excerpt.split("\n").slice(0, 60).join("\n")}</pre>
            ) : (
              <p className="py-6 text-center text-[12.5px] text-text-3">No robots.txt — all URLs may be crawled.</p>
            )}
          </CardBody>
        </Card>
      </Grid>
    </>
  );
}

/* ------------------------------------------------ HTTPS ------------------------------------------------ */
function Https({ ctx, rows }: { ctx: AuditCtx; rows: StatRow[] }) {
  const { crawl } = ctx;
  const site = crawl.site;
  const html = rows.filter(isHtmlRow);
  const n = html.length || 1;
  const pages = (id: string) => crawl.stats.pagesByCheck?.[id] ?? 0;
  const days = site.tls?.validTo ? Math.floor((new Date(site.tls.validTo).getTime() - Date.now()) / 86400000) : null;
  const headers = [
    { label: "Strict-Transport-Security", v: html.filter((r) => r.hsts).length },
    { label: "Content-Security-Policy", v: html.filter((r) => r.csp).length },
    { label: "X-Content-Type-Options", v: html.filter((r) => r.xcto).length },
    { label: "X-Frame-Options", v: html.filter((r) => r.xfo).length },
    { label: "Referrer-Policy", v: html.filter((r) => r.refpol).length },
  ];
  const secure = rows.filter((r) => r.status != null && r.https).length;
  const insecure = rows.filter((r) => r.status != null && !r.https).length;
  return (
    <Grid cols={3} className="mb-4">
      <Card>
        <CardHeader title="HTTPS implementation" />
        <CardBody>
          <ul className="divide-y divide-border">
            <PassFail ok={site.probed ? site.https.supported : null} detail={site.https?.error ?? `https://${site.host}/ answers over TLS`}>
              HTTPS available
            </PassFail>
            <PassFail ok={site.probed ? site.https.httpRedirects !== false && !(site.https.httpStatus && site.https.httpStatus < 300) : null} detail={site.https?.httpStatus ? `http://${site.host}/ → ${site.https.httpStatus}${site.https.httpLocation ? ` → ${site.https.httpLocation}` : ""}` : "HTTP not reachable"}>
              HTTP redirects to HTTPS
            </PassFail>
            <PassFail ok={site.tls ? !site.tls.error && (days ?? 0) > 30 : null} detail={site.tls?.error ?? (site.tls?.validTo ? `Expires ${new Date(site.tls.validTo).toDateString()} (${days} days) · ${site.tls.issuer ?? "unknown issuer"}` : "n/a")}>
              Valid security certificate
            </PassFail>
            <PassFail ok={site.tls?.protocol ? !["TLSv1", "TLSv1.1", "SSLv3"].includes(site.tls.protocol) : null} detail={site.tls?.protocol ?? "n/a"}>
              Modern TLS protocol
            </PassFail>
            <PassFail ok={html.length ? html.some((r) => r.hsts) : null} detail={html.find((r) => r.hsts)?.hsts ?? "No Strict-Transport-Security header"}>
              HSTS enabled
            </PassFail>
            <PassFail ok={pages("mixed-content") === 0} detail={`${pages("mixed-content")} pages load insecure resources`}>
              No mixed content
            </PassFail>
            <PassFail ok={pages("http-link-on-https") === 0} detail={`${pages("http-link-on-https")} pages link to http:// URLs`}>
              Internal links use HTTPS
            </PassFail>
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Secure vs non-secure URLs" />
        <CardBody>
          <DonutChart
            data={[
              { label: "HTTPS", value: secure, color: "var(--good)" },
              { label: "HTTP", value: insecure, color: "var(--critical)" },
            ].filter((x) => x.value > 0)}
            size={128}
            format="number"
            centerValue={share(secure, secure + insecure)}
            centerLabel="secure"
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Security headers" description="Share of HTML pages sending each header" />
        <CardBody>
          <ul className="space-y-2.5">
            {headers.map((h) => (
              <li key={h.label} className="text-[12.5px]">
                <div className="mb-1 flex justify-between">
                  <span className="text-text-2">{h.label}</span>
                  <span className="tabular text-text">{Math.round((h.v / n) * 100)}%</span>
                </div>
                <Bar value={(h.v / n) * 100} color={h.v === 0 ? "var(--critical)" : h.v < n ? "var(--warning)" : "var(--good)"} />
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </Grid>
  );
}

/* ------------------------------------------------ International ------------------------------------------------ */
async function International({ ctx, rows }: { ctx: AuditCtx; rows: StatRow[] }) {
  const html = rows.filter(isHtmlRow);
  const langs = new Map<string, number>();
  for (const r of html) langs.set(r.lang ?? "(missing)", (langs.get(r.lang ?? "(missing)") ?? 0) + 1);
  const hl = await hreflangRows(ctx.crawl.id);
  const codes = new Map<string, number>();
  for (const r of hl) for (const x of r.hreflang) codes.set(x.lang, (codes.get(x.lang) ?? 0) + 1);
  return (
    <>
      <Card className="mb-4">
        <MetricStrip>
          <Metric label="Pages with hreflang" value={html.filter((r) => (r.hreflang ?? 0) > 0).length.toLocaleString()} sub={`of ${html.length} HTML pages`} />
          <Metric label="hreflang codes" value={codes.size} sub={[...codes.keys()].slice(0, 5).join(", ") || "none"} />
          <Metric label="Page languages" value={[...langs.keys()].filter((l) => l !== "(missing)").length} sub="Distinct lang attributes" />
          <Metric label="Missing lang" value={(langs.get("(missing)") ?? 0).toLocaleString()} sub="HTML pages" />
        </MetricStrip>
      </Card>
      {!hl.length && (
        <Callout tone="info" className="mb-4" title="No hreflang annotations found">
          That's fine for a single-language site. If you publish translated or regional versions, link them with rel=&quot;alternate&quot; hreflang tags (with return links and x-default).
        </Callout>
      )}
      <Grid cols={2} className="mb-4 lg:grid-cols-[1fr_1.8fr]">
        <Card>
          <CardHeader title="lang attributes" description="<html lang> values across HTML pages" />
          <CardBody>
            <MiniTable columns={[{ header: "lang" }, { header: "Pages", align: "right" }]} rows={[...langs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([l, v]) => [<span key="l" className={cn("font-mono", l === "(missing)" && "text-critical-ink")}>{l}</span>, v])} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="hreflang clusters" description="Pages and the alternates they declare" />
          <CardBody>
            <MiniTable
              empty="No pages declare hreflang alternates."
              columns={[{ header: "Page" }, { header: "lang" }, { header: "Alternates" }]}
              rows={hl.slice(0, 15).map((r) => [
                <PageLink key="p" ctx={ctx} r={r} />,
                <span key="l" className="font-mono">{r.lang ?? "—"}</span>,
                <span key="a" className="flex flex-wrap gap-1">
                  {r.hreflang.slice(0, 8).map((x, i) => (
                    <Badge key={i} tone={x.lang.toLowerCase() === "x-default" ? "brand" : "neutral"} title={x.href ?? x.raw}>
                      {x.lang}
                    </Badge>
                  ))}
                  {r.hreflang.length > 8 && <span className="text-[11.5px] text-text-3">+{r.hreflang.length - 8}</span>}
                </span>,
              ])}
            />
          </CardBody>
        </Card>
      </Grid>
    </>
  );
}

/* ------------------------------------------------ Core Web Vitals ------------------------------------------------ */
function MetricChip({ m, kind }: { m: PsiMetric | undefined; kind: keyof typeof CWV_THRESHOLDS }) {
  if (!m || m.value == null) return <span className="text-text-3">n/a</span>;
  const text = kind === "cls" ? m.value.toFixed(2) : fmtMs(m.value);
  const tone = m.status === "good" ? "bg-good-soft text-good-ink" : m.status === "ni" ? "bg-warning-soft text-warning-ink" : "bg-critical-soft text-critical-ink";
  return <span className={cn("tabular inline-block rounded px-1.5 py-0.5 text-[12px] font-medium", tone)}>{text}</span>;
}
function Cwv({ ctx }: { ctx: AuditCtx }) {
  const { crawl, project } = ctx;
  const cwv = crawl.cwv;
  const ok = cwv?.pages.filter((p) => p.ok) ?? [];
  const origin = ok.find((p) => p.origin)?.origin ?? null;
  const legend = (
    <p className="text-[12px] text-text-3">
      Thresholds (good / poor): LCP ≤ 2.5 s / &gt; 4 s · INP ≤ 200 ms / &gt; 500 ms · CLS ≤ 0.1 / &gt; 0.25 · TBT ≤ 200 ms / &gt; 600 ms. Field data is the 75th percentile of real Chrome users (CrUX); lab data is a single Lighthouse run.
    </p>
  );
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12.5px] text-text-3">
          Source: Google PageSpeed Insights ({cwv?.strategy ?? crawl.config.device}){cwv?.measuredAt ? ` · measured ${new Date(cwv.measuredAt).toUTCString().slice(5, 22)} UTC` : ""} · results cached 24 h
        </div>
        {!crawl.details_pruned && <RemeasureCwvButton projectId={project.id} crawlId={crawl.id} runningJobId={ctx.runningCwvJob} />}
      </div>
      {(!cwv || cwv.status !== "ok") && (
        <Callout tone={cwv?.status === "partial" ? "warning" : "info"} className="mb-4" title={!cwv ? "Core Web Vitals were not measured for this crawl" : cwv.status === "disabled" ? "PageSpeed Insights is disabled" : cwv.status === "partial" ? "Some pages could not be measured" : "PageSpeed Insights is unavailable right now"}>
          {cwv?.note ?? "The crawl was stopped before measurement."} The rest of the audit is unaffected.
          {cwv?.status !== "disabled" && !/PAGESPEED_API_KEY/.test(cwv?.note ?? "") && " A free PAGESPEED_API_KEY (Google Cloud) gives a reliable quota."} Then click “Measure again”.
        </Callout>
      )}
      {origin && (
        <Card className="mb-4">
          <CardHeader title="Origin field data (all pages, real users)" description={`Overall: ${origin.overall ?? "n/a"}`} />
          <CardBody>
            <div className="grid grid-cols-3 gap-4 text-[13px]">
              <div>
                <div className="text-text-3">LCP</div>
                <MetricChip m={origin.lcp} kind="lcp" />
              </div>
              <div>
                <div className="text-text-3">INP</div>
                <MetricChip m={origin.inp} kind="inp" />
              </div>
              <div>
                <div className="text-text-3">CLS</div>
                <MetricChip m={origin.cls} kind="cls" />
              </div>
            </div>
          </CardBody>
        </Card>
      )}
      <Card className="mb-4">
        <CardHeader title="Measured pages" description="Homepage plus the best-linked pages" />
        <CardBody>
          <MiniTable
            empty="No measurements."
            columns={[
              { header: "Page" },
              { header: "Score", align: "right" },
              { header: "LCP", align: "right" },
              { header: "INP (field)", align: "right" },
              { header: "CLS", align: "right" },
              { header: "TBT (lab)", align: "right" },
              { header: "FCP", align: "right" },
            ]}
            rows={(cwv?.pages ?? []).map((p) => [
              <div key="u" className="max-w-[300px] min-w-[160px]">
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="block truncate text-link hover:underline" title={p.url}>
                  {shortUrl(p.url)}
                </a>
                {!p.ok && <div className="truncate text-[11.5px] text-text-3" title={p.error}>{p.error}</div>}
                {p.ok && !p.field && <div className="text-[11.5px] text-text-3">No field data for this URL (lab only)</div>}
              </div>,
              p.score == null ? <span key="s" className="text-text-3">n/a</span> : <Badge key="s" tone={p.score >= 90 ? "good" : p.score >= 50 ? "warning" : "critical"}>{p.score}</Badge>,
              <MetricChip key="lcp" m={p.field?.lcp.value != null ? p.field.lcp : p.lab.lcp} kind="lcp" />,
              <MetricChip key="inp" m={p.field?.inp} kind="inp" />,
              <MetricChip key="cls" m={p.field?.cls.value != null ? p.field.cls : p.lab.cls} kind="cls" />,
              <MetricChip key="tbt" m={p.lab.tbt} kind="tbt" />,
              <MetricChip key="fcp" m={p.field?.fcp.value != null ? p.field.fcp : p.lab.fcp} kind="fcp" />,
            ])}
          />
          <div className="mt-3">{legend}</div>
        </CardBody>
      </Card>
    </>
  );
}

/* ------------------------------------------------ Performance ------------------------------------------------ */
function Performance({ ctx, rows }: { ctx: AuditCtx; rows: StatRow[] }) {
  const ok = rows.filter(isOk);
  const html = rows.filter(isHtmlRow);
  const loads = ok.map((r) => r.response_ms).filter((x): x is number => x != null);
  const ttfb = ok.map((r) => r.ttfb).filter((x): x is number => x != null);
  const sizes = html.map((r) => r.size_bytes).filter((x): x is number => x != null);
  const compressed = html.filter((r) => r.enc).length;
  const slow = [...ok].sort((a, b) => (b.response_ms ?? 0) - (a.response_ms ?? 0)).slice(0, 8);
  const large = [...html].sort((a, b) => (b.size_bytes ?? 0) - (a.size_bytes ?? 0)).slice(0, 8);
  const heavy = [...html].sort((a, b) => (b.scripts ?? 0) + (b.styles ?? 0) - ((a.scripts ?? 0) + (a.styles ?? 0))).slice(0, 8);
  return (
    <>
      <Card className="mb-4">
        <MetricStrip>
          <Metric label="Median load time" value={fmtMs(median(loads))} sub={`${loads.filter((x) => x > 1000).length} pages over 1 s`} />
          <Metric label="Median TTFB" value={fmtMs(median(ttfb))} sub="Server response" />
          <Metric label="Median HTML size" value={fmtBytes(median(sizes))} sub={`Total ${fmtBytes(sizes.reduce((a, b) => a + b, 0))}`} />
          <Metric label="Compressed" value={share(compressed, html.length)} sub="gzip / Brotli HTML" />
          <Metric label="Scripts per page" value={(median(html.map((r) => r.scripts ?? 0)) ?? 0).toString()} sub={`${(median(html.map((r) => r.styles ?? 0)) ?? 0)} stylesheets`} />
        </MetricStrip>
      </Card>
      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Load time distribution" />
          <CardBody>
            <BarChart data={bucket(ok, (r) => r.response_ms, LOAD_EDGES)} xKey="label" series={[{ key: "pages", label: "Pages" }]} valueLabels height={200} yFormat="number" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="HTML size distribution" />
          <CardBody>
            <BarChart data={bucket(html, (r) => r.size_bytes, SIZE_EDGES)} xKey="label" series={[{ key: "pages", label: "Pages" }]} valueLabels height={200} yFormat="number" />
          </CardBody>
        </Card>
      </Grid>
      <Grid cols={3} className="mb-4">
        <Card>
          <CardHeader title="Slowest pages" />
          <CardBody>
            <MiniTable columns={[{ header: "Page" }, { header: "Load", align: "right" }, { header: "TTFB", align: "right" }]} rows={slow.map((r) => [<PageLink key="p" ctx={ctx} r={r} />, fmtMs(r.response_ms), fmtMs(r.ttfb)])} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Largest pages" />
          <CardBody>
            <MiniTable columns={[{ header: "Page" }, { header: "HTML", align: "right" }, { header: "Enc.", align: "right" }]} rows={large.map((r) => [<PageLink key="p" ctx={ctx} r={r} />, fmtBytes(r.size_bytes), r.enc ?? <span key="n" className="text-critical-ink">none</span>])} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Most JS and CSS files" />
          <CardBody>
            <MiniTable columns={[{ header: "Page" }, { header: "JS", align: "right" }, { header: "CSS", align: "right" }]} rows={heavy.map((r) => [<PageLink key="p" ctx={ctx} r={r} />, r.scripts ?? 0, r.styles ?? 0])} />
          </CardBody>
        </Card>
      </Grid>
    </>
  );
}

/* ------------------------------------------------ Internal linking ------------------------------------------------ */
async function Linking({ ctx, rows }: { ctx: AuditCtx; rows: StatRow[] }) {
  const { crawl } = ctx;
  const html = rows.filter(isHtmlRow);
  const idx = rows.filter((r) => r.indexable);
  const broken = await issueRows(crawl.id, "broken-internal-links");
  const most = [...idx].sort((a, b) => b.inlinks - a.inlinks).slice(0, 8);
  const least = idx.filter((r) => r.depth !== 0).sort((a, b) => a.inlinks - b.inlinks || (b.depth ?? 99) - (a.depth ?? 99)).slice(0, 8);
  const totalInt = html.reduce((s, r) => s + (r.int_links ?? 0), 0);
  const pages = (id: string) => crawl.stats.pagesByCheck?.[id] ?? 0;
  return (
    <>
      <Card className="mb-4">
        <MetricStrip>
          <Metric label="Internal links" value={totalInt.toLocaleString()} sub={`${(totalInt / (html.length || 1)).toFixed(0)} per page`} />
          <Metric label="Broken internal links" value={(crawl.stats.byCheck["broken-internal-links"] ?? 0).toLocaleString()} sub={`on ${pages("broken-internal-links")} pages`} />
          <Metric label="Pages with 1 inlink" value={pages("single-inlink").toLocaleString()} />
          <Metric label="Orphaned sitemap pages" value={pages("orphan-sitemap").toLocaleString()} />
          <Metric label="Deeper than 3 clicks" value={pages("deep-pages").toLocaleString()} />
        </MetricStrip>
      </Card>
      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Incoming internal links" description="Distribution across indexable pages" />
          <CardBody>
            <BarChart data={bucket(idx, (r) => r.inlinks, INLINK_EDGES)} xKey="label" series={[{ key: "pages", label: "Pages" }]} valueLabels height={200} yFormat="number" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Crawl depth" />
          <CardBody>
            <BarChart data={depthData(rows)} xKey="label" series={[{ key: "pages", label: "Pages" }]} valueLabels height={200} yFormat="number" />
          </CardBody>
        </Card>
      </Grid>
      <Grid cols={3} className="mb-4">
        <Card>
          <CardHeader title="Most linked pages" />
          <CardBody>
            <MiniTable columns={[{ header: "Page" }, { header: "Inlinks", align: "right" }]} rows={most.map((r) => [<PageLink key="p" ctx={ctx} r={r} />, r.inlinks])} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Least linked pages" description="Indexable pages with the fewest inlinks" />
          <CardBody>
            <MiniTable columns={[{ header: "Page" }, { header: "Inlinks", align: "right" }, { header: "Depth", align: "right" }]} rows={least.map((r) => [<PageLink key="p" ctx={ctx} r={r} />, r.inlinks, r.depth ?? "n/a"])} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Broken internal links" href={ctx.href({ tab: "issues", issue: "broken-internal-links" })} />
          <CardBody>
            <MiniTable
              empty="No broken internal links."
              columns={[{ header: "Found on" }, { header: "Broken target" }]}
              rows={broken.slice(0, 8).map((r) => [
                r.page_id ? <PageLink key="p" ctx={ctx} r={{ id: r.page_id, url: r.url }} /> : shortUrl(r.url),
                <span key="t" className="block max-w-[220px] truncate text-[12px] text-critical-ink" title={r.detail}>
                  {shortUrl(r.detail)}
                </span>,
              ])}
            />
          </CardBody>
        </Card>
      </Grid>
    </>
  );
}

/* ------------------------------------------------ Markup ------------------------------------------------ */
async function Markup({ ctx, rows }: { ctx: AuditCtx; rows: StatRow[] }) {
  const html = rows.filter(isHtmlRow);
  const n = html.length || 1;
  const invalid = await issueRows(ctx.crawl.id, "invalid-structured-data");
  const ld = new Map<string, number>();
  for (const r of html) for (const t of r.ld_types ?? []) ld.set(t, (ld.get(t) ?? 0) + 1);
  const coverage: { label: string; v: number; good?: boolean }[] = [
    { label: "Structured data (JSON-LD or microdata)", v: html.filter((r) => (r.ld_count ?? 0) > 0 || (r.microdata ?? 0) > 0).length },
    { label: "Open Graph (og:title)", v: html.filter((r) => r.has_og).length },
    { label: "Twitter Card", v: html.filter((r) => r.has_tw).length },
    { label: "Viewport meta tag", v: html.filter((r) => r.viewport).length, good: true },
    { label: "Doctype", v: html.filter((r) => r.doctype).length, good: true },
    { label: "Charset declared", v: html.filter((r) => r.charset).length, good: true },
  ];
  return (
    <Grid cols={3} className="mb-4">
      <Card>
        <CardHeader title="Markup coverage" description={`${html.length} HTML pages`} />
        <CardBody>
          <ul className="space-y-2.5">
            {coverage.map((c) => (
              <li key={c.label} className="text-[12.5px]">
                <div className="mb-1 flex justify-between gap-2">
                  <span className="text-text-2">{c.label}</span>
                  <span className="tabular text-text">{Math.round((c.v / n) * 100)}%</span>
                </div>
                <Bar value={(c.v / n) * 100} />
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Schema.org types" description="Pages using each JSON-LD @type" />
        <CardBody>
          {ld.size ? (
            <DonutChart data={[...ld.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} size={120} format="number" />
          ) : (
            <p className="py-8 text-center text-[12.5px] text-text-3">No JSON-LD structured data found.</p>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Invalid structured data" href={ctx.href({ tab: "issues", issue: "invalid-structured-data" })} />
        <CardBody>
          <MiniTable
            empty="All JSON-LD blocks parsed correctly."
            columns={[{ header: "Page" }, { header: "Problem" }]}
            rows={invalid.slice(0, 8).map((r) => [
              r.page_id ? <PageLink key="p" ctx={ctx} r={{ id: r.page_id, url: r.url }} /> : shortUrl(r.url),
              <span key="d" className="block max-w-[220px] truncate text-[12px] text-critical-ink" title={r.detail}>
                {r.detail}
              </span>,
            ])}
          />
        </CardBody>
      </Card>
    </Grid>
  );
}

