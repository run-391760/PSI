import Link from "next/link";
import type { ReactNode } from "react";
import type { CompareData } from "@/lib/backlinks/types";
import { compact, pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BarChart } from "@/components/charts/bar-chart";
import { MONTH_RANGES, TrendChart } from "@/components/charts/trend-chart";
import { DomainAvatar } from "@/components/seo/badges";
import { Grid } from "@/components/shell/page";
import { Swatch } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

function Delta({ value }: { value: number | null }) {
  if (value == null || value === 0) return null;
  return (
    <span className={cn("ml-1.5 text-[11.5px] font-medium", value > 0 ? "text-good-ink" : "text-critical-ink")}>
      {value > 0 ? "+" : ""}
      {value.toFixed(Math.abs(value) < 10 ? 1 : 0)}%
    </span>
  );
}

export function CompareSections({ data }: { data: CompareData }) {
  const e = data.entries;
  const series = e.map((x, i) => ({ key: `d${i}`, label: x.domain }));
  const best = (get: (i: number) => number) => {
    const vals = e.map((_, i) => get(i));
    return vals.indexOf(Math.max(...vals));
  };
  const rows: { label: string; info?: string; cell: (i: number) => ReactNode; bestIdx?: number }[] = [
    { label: "Authority Score", cell: (i) => e[i].authorityScore || "n/a", bestIdx: best((i) => e[i].authorityScore) },
    {
      label: "Referring domains",
      cell: (i) => (
        <>
          {compact(e[i].referringDomains)}
          <Delta value={e[i].referringDomainsDelta} />
        </>
      ),
      bestIdx: best((i) => e[i].referringDomains),
    },
    {
      label: "Backlinks",
      cell: (i) => (
        <>
          {compact(e[i].backlinks)}
          <Delta value={e[i].backlinksDelta} />
        </>
      ),
      bestIdx: best((i) => e[i].backlinks),
    },
    { label: "Referring IPs", cell: (i) => compact(e[i].referringIps), bestIdx: best((i) => e[i].referringIps) },
    { label: "Follow links", cell: (i) => (e[i].backlinks ? pct(e[i].followPct, 1) : "n/a") },
    { label: "Text / image links", cell: (i) => (e[i].backlinks ? `${pct(e[i].textPct, 0)} / ${pct(e[i].imagePct, 1)}` : "n/a") },
    { label: "New ref. domains (30d)", cell: (i) => { const l = e[i].last30; return l ? <span className="text-good-ink">+{compact(l.newRd)}</span> : <span className="text-text-3">n/a</span>; }, bestIdx: best((i) => e[i].last30?.newRd ?? -1) },
    { label: "Lost ref. domains (30d)", cell: (i) => { const l = e[i].last30; return l ? <span className="text-critical-ink">−{compact(l.lostRd)}</span> : <span className="text-text-3">n/a</span>; } },
    ...(e.some((x) => x.topCategory && x.topCategory !== "n/a") ? [{ label: "Top category", cell: (i: number) => <span className="text-text-2">{e[i].topCategory || "n/a"}</span> }] : []),
  ];
  return (
    <>
      <Card className="mb-4">
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-surface-2 text-left text-[12px] text-text-2">
                <th className="sticky left-0 z-10 min-w-40 border-b border-border bg-surface-2 px-4 py-2.5 font-medium">Metric</th>
                {e.map((x, i) => (
                  <th key={x.domain} className="min-w-40 border-b border-border px-4 py-2.5 text-right font-medium">
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <Swatch color={`var(--series-${i + 1})`} />
                      <DomainAvatar domain={x.domain} />
                      <Link href={`/backlink-analytics?q=${encodeURIComponent(x.domain)}`} className="truncate text-link hover:underline">
                        {x.domain}
                      </Link>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b border-border last:border-0 hover:bg-surface-2">
                  <td className="sticky left-0 z-10 bg-surface px-4 py-2.5 text-text-2">{r.label}</td>
                  {e.map((x, i) => (
                    <td key={x.domain} className={cn("tabular px-4 py-2.5 text-right whitespace-nowrap", r.bestIdx === i && e.length > 1 ? "font-semibold text-text" : "text-text")}>
                      {r.cell(i)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.common.referringDomains > 0 && (
          <div className="border-t border-border px-4 py-2.5 text-[12.5px] text-text-2">
            {compact(data.common.referringDomains)} referring domains in the sample link to all {e.length} domains ({pct(data.common.sampleOverlapPct)} of {e[0].domain}&apos;s sample).{" "}
            <Link href={`/backlink-gap?q=${encodeURIComponent(e.map((x) => x.domain).join(","))}`} className="text-link hover:underline">
              Find link gaps →
            </Link>
          </div>
        )}
      </Card>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Referring domains trend" description="Monthly referring domains per domain" />
          <CardBody>
            {data.rdHistory.length ? <TrendChart data={data.rdHistory} xKey="month" series={series} ranges={MONTH_RANGES} defaultRange="2y" height={260} /> : <p className="py-8 text-center text-[13px] text-text-3">No history available.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Backlinks trend" description="Monthly backlinks per domain" />
          <CardBody>
            {data.blHistory.length ? <TrendChart data={data.blHistory} xKey="month" series={series} ranges={MONTH_RANGES} defaultRange="2y" height={260} /> : <p className="py-8 text-center text-[13px] text-text-3">No history available.</p>}
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Authority Score of referring domains" description="Share of each domain's referring domains per AS range" />
          <CardBody>
            {data.asBuckets.length ? <BarChart data={data.asBuckets} xKey="label" series={series} yFormat="percent" height={260} /> : <p className="py-8 text-center text-[13px] text-text-3">Not available from the connected provider.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="New vs lost referring domains" description="Last 30 days" />
          <CardBody>
            {data.newLost.length ? (
              <BarChart
                data={data.newLost}
                xKey="label"
                series={[
                  { key: "new", label: "New", color: "var(--good)" },
                  { key: "lost", label: "Lost", color: "var(--critical)" },
                ]}
                height={260}
              />
            ) : (
              <p className="py-8 text-center text-[13px] text-text-3">Not available from the connected provider.</p>
            )}
          </CardBody>
        </Card>
      </Grid>
    </>
  );
}
