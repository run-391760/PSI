import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { CHECKS, SEVERITY_ORDER, THEMES } from "@/lib/site-audit/checks";
import type { Severity } from "@/lib/site-audit/types";
import { dateTimeLabel, timeAgo } from "@/lib/format";
import { Sparkline } from "@/components/seo/badges";
import { TrendChart } from "@/components/charts/trend-chart";
import { Grid } from "@/components/shell/page";
import { CountDelta, countUnit, fmtMs, PassFail, scoreColor, SEV_COLOR, SEV_PLURAL, SeverityIcon } from "@/components/site-audit/ui";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { ScoreRing } from "@/components/ui/progress";
import { type AuditCtx, crawlLabel } from "./context";

export function OverviewView({ ctx }: { ctx: AuditCtx }) {
  const { crawl, previous, href } = ctx;
  const stats = crawl.stats;
  const b = stats.breakdown;
  const hist = ctx.crawls.filter((c) => c.started_at <= crawl.started_at).reverse();
  const health = crawl.health ?? 0;
  const healthDelta = previous?.health != null ? health - previous.health : null;
  const fetched = b.healthy + b.issues + b.broken + b.redirected + b.blocked;
  const fetchedPages = stats.fetched ?? fetched;
  const pagesWithoutErrors = Math.max(0, fetchedPages - (stats.pagesWithErrors ?? 0));

  const segments = [
    { key: "healthy", label: "Healthy", value: b.healthy, color: "var(--good)", filter: { issues: "healthy" } },
    { key: "issues", label: "Have issues", value: b.issues, color: "var(--warning)", filter: { issues: "issues" } },
    { key: "broken", label: "Broken", value: b.broken, color: "var(--critical)", filter: { issues: "broken" } },
    { key: "redirected", label: "Redirected", value: b.redirected, color: "var(--series-1)", filter: { status: "3xx" } },
    { key: "blocked", label: "Blocked", value: b.blocked, color: "var(--text-3)", filter: { index: "no" } },
  ];
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;

  const failing = CHECKS.filter((c) => (stats.byCheck[c.id] ?? 0) > 0).sort((x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity] || (stats.byCheck[y.id] ?? 0) - (stats.byCheck[x.id] ?? 0));
  const top = failing.slice(0, 8);
  const site = crawl.site;
  const goodMap = site.sitemaps?.find((f) => f.status === 200 && (f.kind === "urlset" || f.kind === "index"));
  const trend = hist.map((c) => ({ x: crawlLabel(c).replace(" UTC", ""), health: c.health ?? 0, errors: c.errors, warnings: c.warnings, notices: c.notices }));
  const sevRows: { sev: Severity; value: number; prev: number | null; spark: number[] }[] = [
    { sev: "error", value: crawl.errors, prev: previous?.errors ?? null, spark: hist.map((c) => c.errors) },
    { sev: "warning", value: crawl.warnings, prev: previous?.warnings ?? null, spark: hist.map((c) => c.warnings) },
    { sev: "notice", value: crawl.notices, prev: previous?.notices ?? null, spark: hist.map((c) => c.notices) },
  ];
  const durationMs = stats.durationMs ?? 0;

  return (
    <>
      {site.throttled && (
        <Callout tone="warning" className="mb-4" title="The site limited the crawler, so this audit is partial">
          {site.throttled}
        </Callout>
      )}
      <Grid cols={3} className="mb-4 xl:grid-cols-[1fr_1.25fr_1fr]">
        <Card>
          <CardHeader title="Site Health" info="Share of crawled pages without errors (80% weight) and without warnings (20% weight), minus up to 12 points for site-wide errors (certificate, HTTPS redirect, www, robots/sitemap…)." />
          <CardBody className="flex flex-wrap items-center gap-5">
            <ScoreRing value={health} size={124} stroke={12} label={`${health}%`} />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="text-[13px] text-text-2">
                {healthDelta == null ? (
                  <span className="text-text-3">First crawl — the delta appears after the next one.</span>
                ) : (
                  <>
                    <CountDelta delta={healthDelta} upIsGood suffix=" pts" showZero /> <span className="text-text-3">vs previous crawl</span>
                  </>
                )}
              </div>
              <div className="text-[12.5px] text-text-3">
                {pct(pagesWithoutErrors, fetchedPages)} of crawled pages have no errors
                {stats.pagesWithWarnings != null && <> · {pct(fetchedPages - stats.pagesWithWarnings, fetchedPages)} have no warnings</>}
              </div>
              {hist.length > 1 && (
                <div className="pt-1">
                  <Sparkline values={hist.map((c) => c.health ?? 0)} width={150} height={32} color={scoreColor(health)} />
                  <div className="text-[11.5px] text-text-3">Last {hist.length} crawls</div>
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Crawled pages" description={`${crawl.pages_crawled.toLocaleString()} URL${crawl.pages_crawled === 1 ? "" : "s"} fetched · ${crawl.config.limit} page limit`} href={href({ tab: "pages" })} />
          <CardBody>
            <div className="text-[34px] leading-none font-semibold tracking-tight text-text tabular">{total.toLocaleString()}</div>
            <div className="mt-3 flex h-3 w-full gap-[2px] overflow-hidden rounded-full" aria-hidden>
              {segments
                .filter((s) => s.value > 0)
                .map((s) => (
                  <div key={s.key} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} className="h-full first:rounded-l-full last:rounded-r-full" title={`${s.label}: ${s.value}`} />
                ))}
            </div>
            <ul className="mt-3 grid grid-cols-1 gap-x-5 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
              {segments.map((s) => (
                <li key={s.key}>
                  <Link href={href({ tab: "pages", ...s.filter })} className="group flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
                    <span className="flex-1 text-text-2 group-hover:text-link">{s.label}</span>
                    <span className="tabular font-medium text-text group-hover:text-link">{s.value.toLocaleString()}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Issues found" description={previous ? `Change vs crawl of ${crawlLabel(previous)}` : "Issue instances by severity"} href={href({ tab: "issues" })} />
          <CardBody>
            <ul className="divide-y divide-border">
              {sevRows.map((r) => (
                <li key={r.sev} className="flex items-center gap-3 py-2">
                  <SeverityIcon severity={r.sev} />
                  <Link href={href({ tab: "issues", severity: r.sev })} className="min-w-0 flex-1 text-[13px] text-text-2 hover:text-link">
                    {SEV_PLURAL[r.sev]}
                  </Link>
                  {r.spark.length > 1 && <Sparkline values={r.spark} width={64} height={20} color={SEV_COLOR[r.sev]} fill={false} />}
                  <span className="w-14 text-right">{r.prev != null && <CountDelta delta={r.value - r.prev} />}</span>
                  <Link href={href({ tab: "issues", severity: r.sev })} className="tabular w-14 text-right text-[18px] font-semibold text-text hover:text-link">
                    {r.value.toLocaleString()}
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </Grid>

      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold text-text">Thematic reports</h2>
        <Link href={href({ tab: "reports" })} className="text-[12.5px] text-link hover:underline">
          All reports →
        </Link>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {THEMES.map((t) => {
          const v = stats.themes?.[t.key] ?? null;
          const catIssues = CHECKS.filter((c) => c.category === t.category).reduce((s, c) => s + (stats.byCheck[c.id] ?? 0), 0);
          return (
            <Link key={t.key} href={href({ tab: "reports", theme: t.key })} className="group rounded-lg border border-border bg-surface p-3 shadow-card transition-colors hover:border-border-strong">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-text group-hover:text-link">{t.label}</span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <ScoreRing value={v ?? 0} size={52} stroke={6} label={v == null ? "n/a" : `${v}%`} color={v == null ? "var(--surface-3)" : undefined} />
                <div className="min-w-0 text-[11.5px] leading-snug text-text-3">
                  {t.key === "cwv" && v == null ? cwvNote(crawl.cwv?.status) : `${catIssues.toLocaleString()} issue${catIssues === 1 ? "" : "s"}`}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <Grid cols={2} className="mb-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Top issues" description={failing.length ? `${failing.length} of ${CHECKS.length} checks found problems` : "Every check passed"} href={href({ tab: "issues" })} />
          <CardBody className="px-0 pb-0">
            {top.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-good-ink">No issues found on the crawled pages.</p>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {top.map((c) => {
                  const n = stats.byCheck[c.id] ?? 0;
                  const pages = stats.pagesByCheck?.[c.id] ?? 0;
                  const prev = previous ? (previous.byCheck?.[c.id] ?? 0) : null;
                  return (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                      <SeverityIcon severity={c.severity} />
                      <div className="min-w-0 flex-1">
                        <Link href={href({ tab: "issues", issue: c.id })} className="text-[13px] text-text hover:text-link hover:underline">
                          {c.title}
                        </Link>
                        <div className="text-[12px] text-text-3">
                          {c.category}
                          {c.scope !== "site" && ` · ${pct(pages, fetchedPages)} of pages`}
                        </div>
                      </div>
                      {prev != null && (prev === 0 ? <span className="rounded bg-critical-soft px-1.5 text-[11px] font-medium text-critical-ink">New</span> : <CountDelta delta={n - prev} />)}
                      <span className="tabular w-20 shrink-0 text-right text-[12.5px] font-medium text-text">{countUnit(c.scope, c.scope === "page" ? pages || n : n)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
          {failing.length > top.length && (
            <CardFooter>
              <Link href={href({ tab: "issues" })} className="text-link hover:underline">
                View all {failing.length} issues →
              </Link>
            </CardFooter>
          )}
        </Card>

        <Card>
          <CardHeader title="Site-wide checks" description={`Probed ${site.origin ?? ""}`} />
          <CardBody>
            <ul className="divide-y divide-border">
              <PassFail
                ok={site.robots?.found ?? false}
                state={site.robots?.found ? "ok" : "notice"}
                detail={site.robots?.found ? `${site.robots.bytes.toLocaleString()} bytes · ${site.robots.sitemaps.length} sitemap reference${site.robots.sitemaps.length === 1 ? "" : "s"}${site.robots.crawlDelay ? ` · Crawl-delay ${site.robots.crawlDelay}s` : ""}` : (site.robots?.error ?? `HTTP ${site.robots?.status ?? "n/a"} — everything may be crawled`)}
              >
                robots.txt {site.robots?.found ? "found" : "not found"}
              </PassFail>
              <PassFail
                ok={!!goodMap}
                state={goodMap ? (site.robots?.sitemaps.length ? "ok" : "warning") : site.sitemaps?.some((f) => f.kind === "invalid" && f.status === 200) ? "error" : "warning"}
                detail={goodMap ? `${site.sitemapUrlCount.toLocaleString()} URLs in ${site.sitemaps.filter((f) => f.status === 200).length} file(s)${site.robots?.sitemaps.length ? "" : " · not referenced in robots.txt"}` : (site.sitemaps?.find((f) => f.errors.length)?.errors[0] ?? "Not in robots.txt, /sitemap.xml or /sitemap_index.xml")}
              >
                XML sitemap {goodMap ? "found" : "not found"}
              </PassFail>
              <PassFail
                ok={null}
                state={!site.probed ? "unknown" : site.llms.found ? (site.llms.problems.length ? "notice" : "ok") : "notice"}
                detail={site.llms?.found ? (site.llms.problems[0] ?? site.llms.firstLine) : site.probed ? "Optional: a markdown guide to your site for AI assistants" : "Not checked (crawl stopped early)"}
              >
                llms.txt {site.llms?.found ? "found" : "not found"}
              </PassFail>
              <PassFail
                ok={null}
                state={!site.probed ? "unknown" : !site.https.supported || site.https.httpRedirects === false || (site.https.httpStatus != null && site.https.httpStatus < 300) ? "error" : "ok"}
                detail={!site.https?.supported ? (site.https?.error ?? "HTTPS unavailable") : site.https.httpRedirects ? `http://${site.host}/ redirects to ${site.https.httpLocation}` : site.https.httpStatus ? `http://${site.host}/ returns ${site.https.httpStatus} without redirecting` : "Port 80 not reachable (HTTPS only)"}
              >
                {site.https?.supported ? "HTTPS enabled" : "HTTPS not available"}
                {site.https?.supported && (site.https.httpRedirects ? " · HTTP redirects to HTTPS" : site.https.httpStatus ? " · HTTP doesn't redirect" : "")}
              </PassFail>
              <PassFail
                ok={null}
                state={!site.tls || (!site.tls.error && !site.tls.validTo) ? "unknown" : site.tls.error ? "error" : site.tls.validTo && new Date(site.tls.validTo).getTime() - Date.now() < 30 * 86400000 ? "error" : "ok"}
                detail={site.tls?.error ?? (site.tls?.validTo ? `Valid until ${new Date(site.tls.validTo).toDateString()} · ${site.tls.protocol ?? ""} · ${site.tls.issuer ?? ""}` : "n/a")}
              >
                TLS certificate
              </PassFail>
              <PassFail ok={null} state={stats.byCheck["no-hsts"] ? "notice" : site.https?.supported ? "ok" : "unknown"} detail={stats.byCheck["no-hsts"] ? "No Strict-Transport-Security header on the homepage" : "Strict-Transport-Security sent"}>
                HSTS
              </PassFail>
              <PassFail ok={null} state={!site.probed ? "unknown" : site.www.ok === false ? "error" : site.www.ok ? "ok" : "unknown"} detail={site.www?.note}>
                www / non-www consistency
              </PassFail>
            </ul>
          </CardBody>
        </Card>
      </Grid>

      {trend.length > 1 ? (
      <Grid cols={2} className="mb-4">
          <Card>
            <CardHeader title="Site Health trend" description="Across your recent crawls" href={href({ tab: "compare" })} />
            <CardBody>
              {trend.length > 1 ? (
                <TrendChart data={trend} xKey="x" xFormat="raw" yFormat="percent" series={[{ key: "health", label: "Site Health" }]} yDomain={[0, 100]} height={210} />
              ) : (
                <p className="py-12 text-center text-[13px] text-text-3">The trend appears after the second crawl. Turn on a weekly schedule in Settings to track changes automatically.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Errors and warnings trend" description="Issue instances per crawl" href={href({ tab: "compare" })} />
            <CardBody>
              {trend.length > 1 ? (
                <TrendChart
                  data={trend}
                  xKey="x"
                  xFormat="raw"
                  series={[
                    { key: "errors", label: "Errors", color: "var(--critical)" },
                    { key: "warnings", label: "Warnings", color: "var(--warning)" },
                  ]}
                  height={210}
                />
              ) : (
                <p className="py-12 text-center text-[13px] text-text-3">Run another crawl to compare issue counts over time.</p>
              )}
            </CardBody>
          </Card>
        </Grid>
      ) : (
        <Callout tone="info" className="mb-4">
          Health and issue trends appear after the second crawl. Turn on a daily or weekly re-crawl in Settings to track changes automatically.
        </Callout>
      )}

      <Card>
        <CardHeader title="Crawl details" actions={<ButtonLink href={href({ tab: "pages" })} size="sm" variant="ghost">Crawled pages <ArrowRight className="h-3.5 w-3.5" /></ButtonLink>} />
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[12.5px] md:grid-cols-4">
            <Detail label="Start URL" value={<a href={crawl.start_url} target="_blank" rel="noopener noreferrer" className="break-all text-link hover:underline">{crawl.start_url}</a>} />
            <Detail label="Finished" value={crawl.finished_at ? `${dateTimeLabel(crawl.finished_at)} (${timeAgo(crawl.finished_at)})` : "n/a"} />
            <Detail label="Duration" value={durationMs ? `${Math.round(durationMs / 1000)} s · ${((crawl.pages_crawled / Math.max(1, durationMs / 1000)) * 60).toFixed(0)} pages/min` : "n/a"} />
            <Detail label="Crawl source" value={{ website: "Website (links)", sitemap: "Sitemap only", both: "Website + sitemap" }[crawl.config.source]} />
            <Detail label="Scope" value={site.scopeNote} />
            <Detail
              label="Politeness"
              value={`${fmtMs(site.effectiveDelayMs)} between requests per host · robots.txt respected${site.backoffEvents ? ` · slowed down ${site.backoffEvents}× when the server struggled` : ""}`}
            />
            <Detail
              label="Coverage"
              value={site.throttled ? "Stopped early: the site rate-limited or challenged the crawler" : site.frontierExhausted ? "All discovered URLs were crawled" : crawl.status === "stopped" ? "Stopped early by user" : `Page limit reached — raise it in Settings to crawl more`}
            />
            <Detail label="External links checked" value={`${site.externalChecked ?? 0} · resources checked: ${site.resourcesChecked ?? 0}`} />
          </dl>
          <p className="mt-3 text-[12px] break-words text-text-3">
            User agent: <span className="font-mono">{site.userAgent}</span>. SynapseSEOBot identifies itself honestly; site owners can target it in robots.txt with “User-agent: SynapseSEOBot”.
          </p>
        </CardBody>
      </Card>
    </>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-text-3">{label}</dt>
      <dd className="mt-0.5 text-text">{value}</dd>
    </div>
  );
}
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "0%");
function cwvNote(status: string | undefined) {
  if (status === "disabled") return "PageSpeed disabled";
  if (status === "unavailable") return "PageSpeed unavailable";
  return "Not measured";
}
