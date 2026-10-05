import { ChevronRight, ListTree } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { classificationsView } from "@/lib/cx/reports/classifications";
import { reportContext } from "@/lib/cx/reports/data";
import { drillBase } from "@/lib/cx/reports/listening";
import { dmy, rangeLabel, SENTIMENT_COLOR, SENTIMENT_LABEL, SENTIMENTS } from "@/lib/cx/reports/model";
import { NoBrand } from "@/components/cx/insights/common";
import { ReportEmpty, ReportFrame } from "@/components/cx/reports/frame";
import { ColumnChartK, DrillTableK, IntervalSelect, LineChartK, TileRow, Widget, type KCell } from "@/components/cx/reports/kit";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";

export const metadata: Metadata = { title: "Classifications" };
type SP = Record<string, string | string[] | undefined>;

export default async function ClassificationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Classifications" />;
  const ctx = await reportContext(brand, sp);
  const v = await classificationsView(ctx, sp);
  const base = drillBase(ctx, "tickets");
  const range = rangeLabel(ctx.filters.range);
  const n = (x: number) => x.toLocaleString("en-US");
  const labels = Object.fromEntries(v.level.items.map((i) => [i.id, i.label]));
  const sentSeries = SENTIMENTS.map((s) => ({ key: s, label: SENTIMENT_LABEL[s], color: SENTIMENT_COLOR[s] }));
  const href = (node: string | null) => {
    const q = new URLSearchParams();
    for (const [k, val] of Object.entries(sp)) if (k !== "node" && val != null) q.set(k, Array.isArray(val) ? val[0] : val);
    if (node) q.set("node", node);
    return `/cx/reports/classifications?${q.toString()}`;
  };
  const here = v.path.length ? v.path[v.path.length - 1].label : "All classifications";
  const restLabel = v.node ? "No sub-classification" : "Unclassified";
  // "Unclassified" = no classification at all; "No sub-classification" = tagged with the node but none of its children.
  const restDrill = (sentiment?: (typeof SENTIMENTS)[number]) => ({
    ...base,
    ...(v.node ? { classification: v.node, dims: { leaf: "1" } } : { classification: "none" }),
    sentiment,
    title: `${v.node ? `${here} · ${restLabel}` : restLabel}${sentiment ? ` · ${SENTIMENT_LABEL[sentiment]}` : ""} · ${range}`,
  });
  const restCell = (value: number, sentiment?: (typeof SENTIMENTS)[number]): KCell => ({ v: n(value), drill: value > 0 ? restDrill(sentiment) : null });
  const levelBars = v.level.items.filter((i) => i.total > 0);
  const cell = (value: number, classification: string, sentiment: (typeof SENTIMENTS)[number] | undefined, title: string): KCell => ({
    v: n(value),
    drill: value > 0 ? { ...base, classification, sentiment, title: `${title} · ${range}` } : null,
  });

  const breadcrumb = (
    <nav aria-label="Classification level" className="flex min-w-0 flex-wrap items-center gap-1 text-[13px]">
      {v.path.length ? (
        <Link href={href(null)} className="text-link hover:underline">
          All classifications
        </Link>
      ) : (
        <span className="font-medium text-text">All classifications</span>
      )}
      {v.path.map((p, i) => (
        <span key={p.id} className="flex min-w-0 items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-3" aria-hidden />
          {i === v.path.length - 1 ? (
            <span className="truncate font-medium text-text">{p.label}</span>
          ) : (
            <Link href={href(p.id)} className="truncate text-link hover:underline">
              {p.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );

  const tiles = (
    <Widget
      id="cx-reports.classifications.tiles"
      title="Ticket classification"
      bare
      table={{ columns: ["Metric", "Tickets"], rows: [["Tickets", v.counts.total], ["Classified", v.counts.classified], ["Unclassified", v.counts.unclassified], ["Classified %", v.counts.rate == null ? null : Math.round(v.counts.rate * 100) / 100]] }}
    >
      <TileRow
        tiles={[
          { key: "total", label: "Tickets", value: n(v.counts.total), drill: { ...base, title: `Tickets · ${range}` } },
          { key: "classified", label: "Classified", value: n(v.counts.classified) },
          { key: "unclassified", label: "Unclassified", value: n(v.counts.unclassified), drill: v.counts.unclassified ? { ...base, classification: "none", title: `Unclassified · ${range}` } : null },
          { key: "rate", label: "Classified rate", value: v.counts.rate == null ? "n/a" : `${v.counts.rate.toFixed(1)}%` },
        ]}
      />
    </Widget>
  );

  return (
    <ReportFrame ctx={ctx} switcher={switcher} page="classifications" title="Classifications" source="Source: stored tickets and their classifications" mediaOptions={v.mediaOptions} filters={{ scope: true, media: true, basis: true }}>
      {v.noTree ? (
        <>
          {!v.empty && tiles}
          <Card>
            <EmptyState
              icon={<ListTree className="h-5 w-5" />}
              title="No classifications defined"
              description="Build a classification tree (for example Complaint > Delivery > Late) and let agents classify tickets; this report then shows tickets per classification."
              action={<ButtonLink href={`/cx/settings/fields?brand=${encodeURIComponent(brand.id)}`} variant="primary">Set up classifications</ButtonLink>}
            />
          </Card>
        </>
      ) : v.empty ? (
        <ReportEmpty brand={brand.id} kind="tickets" what="Classifications counts tickets per classification of your tree, with sentiment and trend." />
      ) : (
        <>
          {tiles}

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 shadow-card">
            {breadcrumb}
            <span className="text-[12.5px] text-text-3">
              {n(v.level.base)} tickets {v.node ? `in ${here}` : "in the period"}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Widget
              id="cx-reports.classifications.bars"
              title={v.node ? `Tickets by sub-classification of ${here}` : "Tickets by classification"}
              info="A ticket counts under a classification when its classification path includes it, so parent counts include their sub-classifications. Click a bar to see the tickets; open a level from the table below."
              table={{ columns: ["Classification", "Tickets", "Share %"], rows: v.level.items.map((i) => [i.label, i.total, Math.round(i.share * 100) / 100]) }}
              insight={{ metric: "Tickets by classification", range, rows: v.level.items.map((i) => ({ key: i.label, value: i.total })), total: v.level.base, previous: null }}
            >
              {levelBars.length ? (
                <ColumnChartK
                  data={levelBars.map((i) => ({ key: i.id, total: i.total }))}
                  catLabels={labels}
                  series={[{ key: "total", label: "Tickets" }]}
                  horizontal
                  shared={false}
                  drill={{ base, x: "classification" }}
                  height={Math.max(160, levelBars.length * 38 + 40)}
                />
              ) : (
                <p className="py-12 text-center text-[13px] text-text-3">No ticket at this level is classified in this period.</p>
              )}
            </Widget>
            <Widget
              id="cx-reports.classifications.sentiment"
              title="Classification × sentiment"
              info="Ticket sentiment (from the ticket's messages) per classification."
              table={{ columns: ["Classification", "Positive", "Negative", "Neutral"], rows: v.level.items.map((i) => [i.label, i.positive, i.negative, i.neutral]) }}
              insight={{ metric: "Tickets by classification and sentiment", range, rows: v.level.items.flatMap((i) => SENTIMENTS.map((s) => ({ key: `${i.label} ${s}`, value: i[s] }))), total: v.level.base, previous: null }}
            >
              {v.sentiment.length ? (
                <ColumnChartK data={v.sentiment} catLabels={labels} series={sentSeries} horizontal drill={{ base, series: "sentiment", x: "classification" }} height={Math.max(160, v.sentiment.length * 38 + 40)} />
              ) : (
                <p className="py-12 text-center text-[13px] text-text-3">No ticket at this level is classified in this period.</p>
              )}
            </Widget>
          </div>

          <Widget
            id="cx-reports.classifications.trend"
            title={v.node ? `Classified tickets over time · ${here}` : "Classified tickets over time"}
            info={v.series.length >= 8 ? "The 8 largest classifications at this level." : undefined}
            actions={<IntervalSelect value={ctx.filters.interval} />}
            table={{ columns: ["Period", ...v.series.map((s) => s.label)], rows: v.trend.map((r) => [dmy(String(r.key)), ...v.series.map((s) => Number(r[s.key] ?? 0))]) }}
            insight={{ metric: "Classified tickets", range, rows: v.trend.map((r) => ({ key: String(r.key), value: v.series.reduce((t, s) => t + Number(r[s.key] ?? 0), 0) })), total: null, previous: null }}
          >
            {v.series.length ? (
              <LineChartK data={v.trend} series={v.series} drill={{ base, series: "classification", x: "bucket" }} interval={ctx.filters.interval} yLabel="Number of tickets" height={280} />
            ) : (
              <p className="py-12 text-center text-[13px] text-text-3">No classified tickets at this level in this period.</p>
            )}
          </Widget>

          <Widget
            id="cx-reports.classifications.table"
            title={v.node ? `Sub-classifications of ${here}` : "Classifications"}
            info={`Click a number to see the tickets. "${restLabel}" is ${v.node ? `tickets of ${here} without a sub-classification` : "tickets without any classification"}.`}
            table={{
              columns: ["Classification", "Tickets", "Positive", "Negative", "Neutral", "Share %"],
              rows: [...v.level.items.map((i) => [i.label, i.total, i.positive, i.negative, i.neutral, Math.round(i.share * 100) / 100]), [restLabel, v.level.rest.total, v.level.rest.positive, v.level.rest.negative, v.level.rest.neutral, Math.round(v.level.rest.share * 100) / 100]],
            }}
          >
            <DrillTableK
              columns={[{ label: "Classification" }, { label: "Tickets" }, { label: "Positive" }, { label: "Negative" }, { label: "Neutral" }, { label: "Share" }]}
              highlightLast
              rows={[
                ...v.level.items.map((i) => [
                  {
                    v: i.hasChildren ? (
                      <Link href={href(i.id)} className="inline-flex items-center gap-1 text-link hover:underline" title="Open sub-classifications">
                        {i.label}
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    ) : (
                      <span>
                        {i.label}
                        {i.hidden && <span className="ml-1 text-[11.5px] font-normal text-text-3">(hidden)</span>}
                      </span>
                    ),
                  },
                  cell(i.total, i.id, undefined, i.label),
                  ...SENTIMENTS.map((s) => cell(i[s], i.id, s, `${i.label} · ${SENTIMENT_LABEL[s]}`)),
                  { v: `${i.share.toFixed(1)}%` },
                ]),
                [{ v: restLabel }, restCell(v.level.rest.total), ...SENTIMENTS.map((s) => restCell(v.level.rest[s], s)), { v: `${v.level.rest.share.toFixed(1)}%` }],
              ]}
            />
          </Widget>
        </>
      )}
    </ReportFrame>
  );
}
