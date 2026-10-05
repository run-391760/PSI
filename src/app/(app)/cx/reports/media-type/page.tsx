import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { reportContext } from "@/lib/cx/reports/data";
import { drillBase } from "@/lib/cx/reports/listening";
import { mediaTypeView } from "@/lib/cx/reports/media";
import { mediaTotals, pct2 } from "@/lib/cx/reports/media-model";
import { dmy, rangeLabel, SENTIMENT_COLOR, SENTIMENT_LABEL, SENTIMENTS } from "@/lib/cx/reports/model";
import { NoBrand } from "@/components/cx/insights/common";
import { ReportEmpty, ReportFrame } from "@/components/cx/reports/frame";
import { ColumnChartK, DrillTableK, IntervalSelect, LineChartK, PieChartK, TileRow, Widget, type KCell } from "@/components/cx/reports/kit";

export const metadata: Metadata = { title: "Media Type Analysis" };
type SP = Record<string, string | string[] | undefined>;

export default async function MediaTypePage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Media Type Analysis" />;
  const ctx = await reportContext(brand, sp);
  const v = await mediaTypeView(ctx);
  const base = drillBase(ctx);
  const range = rangeLabel(ctx.filters.range);
  const labels = Object.fromEntries(v.table.map((t) => [t.mediaType, t.label]));
  const sentSeries = SENTIMENTS.map((s) => ({ key: s, label: SENTIMENT_LABEL[s], color: SENTIMENT_COLOR[s] }));
  const totals = mediaTotals(v.table);
  const n = (x: number) => x.toLocaleString("en-US");
  const cell = (value: number, mediaType: string | undefined, sentiment: (typeof SENTIMENTS)[number] | undefined, title: string): KCell => ({
    v: n(value),
    drill: value > 0 ? { ...base, mediaType, sentiment, title: `${title} · ${range}` } : null,
  });

  return (
    <ReportFrame ctx={ctx} switcher={switcher} page="media" title="Media Type Analysis" mediaOptions={v.mediaOptions} filters={{ scope: true, media: true, basis: true }}>
      {v.empty ? (
        <ReportEmpty brand={brand.id} what="Media Type Analysis splits conversations (listening mentions and tickets) by where they happened: news, social networks, reviews, email, chat and more." />
      ) : (
        <>
          <Widget
            id="cx-reports.media.tiles"
            title="Conversations by media type"
            bare
            table={{ columns: ["Media type", "Conversations", "Previous period", "Change %"], rows: v.kpis.map((k) => [k.label, k.value, k.previous, k.change == null ? null : pct2(k.change)]) }}
          >
            <TileRow
              cols={6}
              tiles={[
                { key: "total", label: "Total", value: n(v.total.value), change: v.total.change, drill: { ...base, title: `All media types · ${range}` } },
                ...v.kpis.map((k) => ({ key: k.mediaType, label: k.label, value: n(k.value), change: k.change, seriesKey: k.mediaType, drill: { ...base, mediaType: k.mediaType, title: `${k.label} · ${range}` } })),
              ]}
              size="md"
            />
          </Widget>

          <Widget
            id="cx-reports.media.trend"
            title="Conversations over time by media type"
            info={v.moreTypes ? `The ${v.series.length} largest media types; ${v.moreTypes} smaller ones are in the table below.` : undefined}
            actions={<IntervalSelect value={ctx.filters.interval} />}
            table={{ columns: ["Period", ...v.series.map((s) => s.label)], rows: v.trend.map((r) => [dmy(String(r.key)), ...v.series.map((s) => Number(r[s.key] ?? 0))]) }}
            insight={{ metric: "Conversations", range, rows: v.trend.map((r) => ({ key: String(r.key), value: v.series.reduce((s, x) => s + Number(r[x.key] ?? 0), 0) })), total: v.total.value, previous: null }}
          >
            <LineChartK data={v.trend} series={v.series} drill={{ base, series: "mediaType", x: "bucket" }} interval={ctx.filters.interval} yLabel="Number of conversations" height={300} />
          </Widget>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Widget
              id="cx-reports.media.share"
              title="Share by media type"
              table={{ columns: ["Media type", "Conversations", "Share %"], rows: v.table.map((t) => [t.label, t.total, pct2(t.share)]) }}
              insight={{ metric: "Conversations by media type", range, rows: v.table.map((t) => ({ key: t.label, value: t.total })), total: v.total.value, previous: null }}
            >
              <PieChartK slices={v.table.map((t) => ({ key: t.mediaType, label: t.label, value: t.total }))} drill={{ base, series: "mediaType" }} donut centerLabel="conversations" height={280} legend={v.table.length <= 12} />
            </Widget>
            <Widget
              id="cx-reports.media.sentiment"
              title="Sentiment by media type (%)"
              table={{ columns: ["Media type", "Positive %", "Negative %", "Neutral %"], rows: v.table.map((t) => [t.label, pct2(t.pctPositive), pct2(t.pctNegative), pct2(t.pctNeutral)]) }}
              insight={{ metric: "Negative share by media type (%)", range, rows: v.table.map((t) => ({ key: t.label, value: pct2(t.pctNegative) })), total: null, previous: null }}
            >
              <ColumnChartK
                data={v.table.map((t) => ({ key: t.mediaType, positive: t.positive, negative: t.negative, neutral: t.neutral }))}
                catLabels={labels}
                series={sentSeries}
                mode="percent"
                drill={{ base, series: "sentiment", x: "mediaType" }}
                yLabel="% of conversations"
                height={300}
              />
            </Widget>
          </div>

          <Widget
            id="cx-reports.media.table"
            title="Media type × sentiment"
            info="Click a number to see the conversations behind it."
            table={{ columns: ["Media type", "Total", "Positive", "Negative", "Neutral", "Share %"], rows: [...v.table.map((t) => [t.label, t.total, t.positive, t.negative, t.neutral, pct2(t.share)]), ["Total", totals.total, totals.positive, totals.negative, totals.neutral, 100]] }}
          >
            <DrillTableK
              columns={[{ label: "Media type" }, { label: "Total" }, { label: "Positive" }, { label: "Negative" }, { label: "Neutral" }, { label: "Share" }]}
              highlightLast
              rows={[
                ...v.table.map((t) => [
                  { v: t.label },
                  cell(t.total, t.mediaType, undefined, t.label),
                  ...SENTIMENTS.map((s) => cell(t[s], t.mediaType, s, `${t.label} · ${SENTIMENT_LABEL[s]}`)),
                  { v: `${t.share.toFixed(1)}%` },
                ]),
                [{ v: "Total" }, cell(totals.total, undefined, undefined, "All media types"), ...SENTIMENTS.map((s) => cell(totals[s], undefined, s, SENTIMENT_LABEL[s])), { v: "100%" }],
              ]}
            />
          </Widget>
        </>
      )}
    </ReportFrame>
  );
}
