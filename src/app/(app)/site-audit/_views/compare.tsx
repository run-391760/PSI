import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { CHECK_MAP, CHECKS, SEVERITY_ORDER } from "@/lib/site-audit/checks";
import { diffCrawls } from "@/lib/site-audit/data";
import { TrendChart } from "@/components/charts/trend-chart";
import { Grid } from "@/components/shell/page";
import { ComparePicker } from "@/components/site-audit/crawl-picker";
import { CountDelta, scoreTone, SeverityIcon, shortUrl } from "@/components/site-audit/ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { type AuditCtx, crawlLabel } from "./context";

export async function CompareView({ ctx }: { ctx: AuditCtx }) {
  const { crawls, href, sp, crawl } = ctx;
  const hist = [...crawls].reverse();
  const trend = hist.map((c) => ({ x: crawlLabel(c).replace(" UTC", ""), health: c.health ?? 0, errors: c.errors, warnings: c.warnings, notices: c.notices, pages: c.pages_crawled }));
  const options = crawls.map((c) => ({ id: c.id, label: crawlLabel(c) }));
  const b = crawls.find((c) => c.id === sp.b) ?? crawls.find((c) => c.id === crawl.id) ?? crawls[0];
  const a = crawls.find((c) => c.id === sp.a) ?? crawls[crawls.indexOf(b) + 1] ?? null;
  const [older, newer] = a && b && a.started_at > b.started_at ? [b, a] : [a, b];
  const diff = older && newer && older.id !== newer.id && !older.details_pruned && !newer.details_pruned ? await diffCrawls(older.id, newer.id) : null;
  const rows = older && newer
    ? CHECKS.filter((c) => (older.byCheck?.[c.id] ?? 0) > 0 || (newer.byCheck?.[c.id] ?? 0) > 0)
        .map((c) => ({ c, a: older.byCheck?.[c.id] ?? 0, b: newer.byCheck?.[c.id] ?? 0, d: diff ? (diff.get(c.id) ?? { added: [], fixed: [] }) : undefined }))
        .sort((x, y) => SEVERITY_ORDER[x.c.severity] - SEVERITY_ORDER[y.c.severity] || Math.abs(y.b - y.a) - Math.abs(x.b - x.a) || y.b - x.b)
    : [];
  let added = 0,
    fixed = 0;
  for (const d of diff?.values() ?? []) {
    added += d.added.length;
    fixed += d.fixed.length;
  }

  return (
    <>
      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Site Health across crawls" description={`${crawls.length} finished crawl${crawls.length === 1 ? "" : "s"}`} />
          <CardBody>
            {trend.length > 1 ? (
              <TrendChart data={trend} xKey="x" xFormat="raw" yFormat="percent" series={[{ key: "health", label: "Site Health" }]} yDomain={[0, 100]} height={220} />
            ) : (
              <p className="py-12 text-center text-[13px] text-text-3">Only one crawl so far. Re-run the audit (or enable a schedule) to see the trend.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Issues across crawls" description="Errors, warnings and notices per crawl" />
          <CardBody>
            {trend.length > 1 ? (
              <TrendChart
                data={trend}
                xKey="x"
                xFormat="raw"
                series={[
                  { key: "errors", label: "Errors", color: "var(--critical)" },
                  { key: "warnings", label: "Warnings", color: "var(--warning)" },
                  { key: "notices", label: "Notices", color: "var(--link)" },
                ]}
                height={220}
              />
            ) : (
              <p className="py-12 text-center text-[13px] text-text-3">The issue trend appears after the second crawl.</p>
            )}
          </CardBody>
        </Card>
      </Grid>

      <Card className="mb-4">
        <CardHeader title="Crawl history" />
        <CardBody>
          <MiniTable
            columns={[
              { header: "Crawl" },
              { header: "Pages", align: "right" },
              { header: "Health", align: "right" },
              { header: "Errors", align: "right" },
              { header: "Warnings", align: "right" },
              { header: "Notices", align: "right" },
              { header: "Duration", align: "right" },
            ]}
            rows={crawls.map((c, i) => {
              const prev = crawls[i + 1];
              return [
                <div key="c" className="flex flex-wrap items-center gap-2">
                  <Link href={i === 0 ? `/site-audit?project=${ctx.project.id}` : `/site-audit?project=${ctx.project.id}&crawl=${c.id}`} className="text-link hover:underline">
                    {crawlLabel(c)}
                  </Link>
                  {c.id === crawl.id && <Badge tone="brand">Viewing</Badge>}
                  {c.details_pruned && <Badge>Summary only</Badge>}
                </div>,
                c.pages_crawled.toLocaleString(),
                <span key="h" className="inline-flex items-center gap-1.5">
                  {prev?.health != null && c.health != null && <CountDelta delta={c.health - prev.health} upIsGood />}
                  <Badge tone={scoreTone(c.health)}>{c.health ?? 0}%</Badge>
                </span>,
                c.errors.toLocaleString(),
                c.warnings.toLocaleString(),
                c.notices.toLocaleString(),
                c.durationMs ? `${Math.round(c.durationMs / 1000)} s` : "n/a",
              ];
            })}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Compare two crawls" description="New and fixed issues by check, matched URL by URL" />
        {options.length > 1 && older && newer && (
          <div className="px-4 pb-3">
            <ComparePicker options={options} a={older.id} b={newer.id} />
          </div>
        )}
        {!older || !newer || older.id === newer.id ? (
          <CardBody>
            <Callout tone="info">Run at least two crawls to compare them. New and fixed issues are matched URL by URL.</Callout>
          </CardBody>
        ) : (
          <>
            <MetricStrip className="border-y border-border">
              <Metric label="Site Health" value={`${older.health ?? 0}% → ${newer.health ?? 0}%`} sub={<CountDelta delta={(newer.health ?? 0) - (older.health ?? 0)} upIsGood suffix=" pts" showZero />} />
              <Metric label="Errors" value={`${older.errors} → ${newer.errors}`} sub={<CountDelta delta={newer.errors - older.errors} showZero />} />
              <Metric label="Warnings" value={`${older.warnings} → ${newer.warnings}`} sub={<CountDelta delta={newer.warnings - older.warnings} showZero />} />
              <Metric label="New issues" value={diff ? added.toLocaleString() : "n/a"} sub="Not present in the older crawl" />
              <Metric label="Fixed issues" value={diff ? fixed.toLocaleString() : "n/a"} sub="Gone from re-crawled pages" />
            </MetricStrip>
            {!diff && (
              <div className="px-4 pt-3">
                <Callout tone="warning">URL-level details of one of these crawls were pruned, so only totals can be compared.</Callout>
              </div>
            )}
            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
                <div className="grid grid-cols-[minmax(0,1fr)_64px_64px_72px_56px_56px] gap-2 border-b border-border bg-surface-2 px-4 py-2 text-[12px] font-medium text-text-2">
                  <span>Issue</span>
                  <span className="text-right">Older</span>
                  <span className="text-right">Newer</span>
                  <span className="text-right">Change</span>
                  <span className="text-right">New</span>
                  <span className="text-right">Fixed</span>
                </div>
                {rows.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-text-3">Neither crawl has issues.</p>}
                {rows.map(({ c, a: ca, b: cb, d }) => (
                  <details key={c.id} className="group border-b border-border last:border-0">
                    <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_64px_64px_72px_56px_56px] items-center gap-2 px-4 py-2 text-[13px] hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
                      <span className="flex min-w-0 items-center gap-2">
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-3 transition-transform group-open:rotate-90" />
                        <SeverityIcon severity={c.severity} />
                        <span className="truncate text-text">{c.title}</span>
                      </span>
                      <span className="tabular text-right text-text-2">{ca.toLocaleString()}</span>
                      <span className="tabular text-right text-text">{cb.toLocaleString()}</span>
                      <span className="text-right">
                        <CountDelta delta={cb - ca} />
                      </span>
                      <span className={`tabular text-right ${d?.added.length ? "text-critical-ink" : "text-text-3"}`}>{d ? d.added.length : "n/a"}</span>
                      <span className={`tabular text-right ${d?.fixed.length ? "text-good-ink" : "text-text-3"}`}>{d ? d.fixed.length : "n/a"}</span>
                    </summary>
                    <div className="grid gap-4 bg-surface-2/60 px-4 py-3 pl-12 text-[12.5px] md:grid-cols-2">
                      <DiffList title="New in the newer crawl" tone="critical" items={d?.added ?? []} />
                      <DiffList title="Fixed since the older crawl" tone="good" items={d?.fixed ?? []} />
                      <div className="md:col-span-2">
                        <Link href={href({ tab: "issues", issue: c.id })} className="text-link hover:underline">
                          Open “{CHECK_MAP[c.id].title}” →
                        </Link>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}

function DiffList({ title, items, tone }: { title: string; items: { url: string; detail: string }[]; tone: "critical" | "good" }) {
  return (
    <div className="min-w-0">
      <div className={`mb-1 font-semibold ${tone === "critical" ? "text-critical-ink" : "text-good-ink"}`}>
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <p className="text-text-3">None</p>
      ) : (
        <ul className="space-y-1">
          {items.slice(0, 10).map((i, k) => (
            <li key={k} className="min-w-0">
              <div className="truncate text-text" title={i.url}>
                {shortUrl(i.url)}
              </div>
              {i.detail && <div className="truncate text-text-3" title={i.detail}>{i.detail}</div>}
            </li>
          ))}
          {items.length > 10 && <li className="text-text-3">+{items.length - 10} more</li>}
        </ul>
      )}
    </div>
  );
}
