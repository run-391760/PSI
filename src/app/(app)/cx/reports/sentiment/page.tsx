import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { mediaLabel } from "@/lib/cx/ops/model";
import { reportContext } from "@/lib/cx/reports/data";
import { drillBase, sentimentView } from "@/lib/cx/reports/listening";
import { dmy, previousRange, rangeLabel, SENTIMENT_COLOR, SENTIMENT_LABEL, SENTIMENTS, type Sentiment } from "@/lib/cx/reports/model";
import { NoBrand } from "@/components/cx/insights/common";
import { ReportEmpty, ReportFrame } from "@/components/cx/reports/frame";
import { Change, ColumnChartK, DrillTableK, IntervalSelect, LineChartK, ParamSelect, PieChartK, PostListK, StatsColumn, TileRow, Widget, WordCloudK } from "@/components/cx/reports/kit";

export const metadata: Metadata = { title: "Sentiment Analysis" };
type SP = Record<string, string | string[] | undefined>;
const fmtPct = (n: number) => `${Math.round(n)} %`;

export default async function SentimentPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Sentiment Analysis" />;
  const ctx = await reportContext(brand, sp);
  const v = await sentimentView(ctx, sp);
  const base = drillBase(ctx);
  const range = rangeLabel(ctx.filters.range);
  const prev = previousRange(ctx.filters.range);
  const names = Object.fromEntries(v.entities.map((e) => [e.id, e.name]));
  const scopeAll = ctx.scope.isDefault ? `All of ${brand.name}` : "All selected";
  const entOptions = [{ value: "", label: scopeAll }, ...v.entities.map((e) => ({ value: e.id, label: e.name }))];
  const badge = ctx.scope.label.length > 28 ? `${ctx.scope.label.slice(0, 27)}…` : ctx.scope.label;
  const sentSeries = SENTIMENTS.map((s) => ({ key: s, label: SENTIMENT_LABEL[s], color: SENTIMENT_COLOR[s] }));
  const ent = (id: string) => id || undefined;
  const ex = v.extremes;
  const exTile = (s: "positive" | "negative", which: "most" | "least", asPct: boolean) => {
    const x = ex[s][which];
    return {
      key: `${which}-${s}-${asPct ? "pct" : "n"}`,
      label: `${which === "most" ? "Most" : "Least"} ${s} posts`,
      value: x ? (asPct ? fmtPct(x.pct) : x.count.toLocaleString("en-US")) : "n/a",
      badge: x?.name,
      badgeTone: s === "positive" ? ("good" as const) : ("critical" as const),
      seriesKey: s,
      info: x ? `${x.name}: ${x.count} ${s} of its conversations (${x.pct.toFixed(1)}%)` : "No conversations",
      drill: x ? { ...base, entity: x.id, sentiment: s as Sentiment, title: `${SENTIMENT_LABEL[s]} · ${x.name}` } : null,
    };
  };

  return (
    <ReportFrame ctx={ctx} switcher={switcher} page="sentiment" title="Sentiment Analysis" mediaOptions={v.mediaOptions} filters={{ scope: true, media: true, basis: true }}>
      {v.empty ? (
        <ReportEmpty brand={brand.id} what="Sentiment Analysis splits conversations (listening mentions and tickets) into positive, negative and neutral over time, by scope and by media type." />
      ) : (
        <>
          <Widget id="cx-reports.sentiment.kpis" title="Overview" bare table={{ columns: ["Measure", "Value", "Change %"], rows: (["total", ...SENTIMENTS] as const).map((k) => [k, v.kpis[k].value, v.kpis[k].change == null ? null : Math.round(v.kpis[k].change! * 100) / 100]) }}>
            <TileRow
              tiles={[
                { key: "total", label: "Total", value: v.kpis.total.value.toLocaleString("en-US"), change: v.kpis.total.change, badge, info: `Change vs ${rangeLabel(prev)}`, drill: { ...base, title: `All conversations · ${range}` } },
                ...SENTIMENTS.map((s) => ({
                  key: s,
                  label: SENTIMENT_LABEL[s],
                  value: v.kpis[s].value.toLocaleString("en-US"),
                  change: v.kpis[s].change,
                  upIsGood: s !== "negative",
                  badge,
                  seriesKey: s,
                  info: `Change vs ${rangeLabel(prev)}`,
                  drill: { ...base, sentiment: s, title: `${SENTIMENT_LABEL[s]} · ${range}` },
                })),
              ]}
            />
          </Widget>

          <Widget
            id="cx-reports.sentiment.overtime"
            title="Sentiment Analysis Over Time"
            actions={
              <>
                <IntervalSelect value={ctx.filters.interval} />
                <ParamSelect param="ot" value={v.overTime.entity} options={entOptions} label="Scope" />
              </>
            }
            table={{ columns: ["Period", "Positive", "Negative", "Neutral"], rows: v.overTime.data.map((r) => [dmy(String(r.key)), Number(r.positive), Number(r.negative), Number(r.neutral)]) }}
            insight={{ metric: "Negative conversations", range, rows: v.overTime.data.map((r) => ({ key: String(r.key), value: Number(r.negative) })), total: v.kpis.negative.value, previous: null }}
          >
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
              <StatsColumn
                title={v.overTime.name}
                items={[
                  { label: "Avg positive per day", value: v.overTime.peaks.avgPositive.toLocaleString("en-US") },
                  { label: "Avg negative per day", value: v.overTime.peaks.avgNegative.toLocaleString("en-US") },
                  { label: "Most positive on", value: v.overTime.peaks.mostPositiveOn ? dmy(v.overTime.peaks.mostPositiveOn) : "n/a", drill: v.overTime.peaks.mostPositiveOn ? { ...base, entity: ent(v.overTime.entity), sentiment: "positive", bucket: v.overTime.peaks.mostPositiveOn, interval: "day", title: `Positive · ${dmy(v.overTime.peaks.mostPositiveOn)}` } : null },
                  { label: "Most negative on", value: v.overTime.peaks.mostNegativeOn ? dmy(v.overTime.peaks.mostNegativeOn) : "n/a", drill: v.overTime.peaks.mostNegativeOn ? { ...base, entity: ent(v.overTime.entity), sentiment: "negative", bucket: v.overTime.peaks.mostNegativeOn, interval: "day", title: `Negative · ${dmy(v.overTime.peaks.mostNegativeOn)}` } : null },
                ]}
              />
              <LineChartK data={v.overTime.data} series={sentSeries} drill={{ base: { ...base, entity: ent(v.overTime.entity) }, series: "sentiment", x: "bucket" }} interval={ctx.filters.interval} yLabel="Number of conversations" height={300} />
            </div>
          </Widget>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Widget id="cx-reports.sentiment.overall" title="Overall Sentiment Analysis" table={{ columns: ["Scope", "Positive", "Negative", "Neutral"], rows: v.byEntity.map((r) => [r.name, r.positive, r.negative, r.neutral]) }}>
              <ColumnChartK data={v.byEntity} catLabels={names} horizontal series={sentSeries} drill={{ base, series: "sentiment", x: "entity" }} height={Math.max(200, v.byEntity.length * 44 + 70)} />
            </Widget>
            <Widget id="cx-reports.sentiment.scale" title="Sentiment Scale out of 100 %" info="Each scope's conversations as 100%, split by sentiment." table={{ columns: ["Scope", "Positive %", "Negative %", "Neutral %"], rows: v.byEntity.map((r) => [r.name, ...SENTIMENTS.map((s) => (r.total ? Math.round((r[s] / r.total) * 1000) / 10 : 0))]) }}>
              <ColumnChartK data={v.byEntity} catLabels={names} mode="percent" series={sentSeries} drill={{ base, series: "sentiment", x: "entity" }} yLabel="% of conversations" height={300} />
            </Widget>
          </div>

          <Widget id="cx-reports.sentiment.extremes" title="Most and least positive / negative" bare>
            <div className="space-y-3">
              <TileRow tiles={[exTile("positive", "most", false), exTile("negative", "most", false), exTile("positive", "least", false), exTile("negative", "least", false)]} />
              <TileRow tiles={[exTile("positive", "most", true), exTile("negative", "most", true), exTile("positive", "least", true), exTile("negative", "least", true)]} />
            </div>
          </Widget>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {(["positive", "negative"] as const).map((s) => (
              <Widget key={s} id={`cx-reports.sentiment.share-${s}`} title={`Relative Share of ${SENTIMENT_LABEL[s]}`} table={{ columns: ["Scope", SENTIMENT_LABEL[s]], rows: v.byEntity.map((r) => [r.name, r[s]]) }}>
                <PieChartK slices={v.byEntity.map((r) => ({ key: r.key, label: r.name, value: r[s] }))} drill={{ base: { ...base, sentiment: s }, series: "entity" }} height={260} />
              </Widget>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Widget id="cx-reports.sentiment.by-brand" title="Sentiment By Brand" table={{ columns: ["Name", "Positive", "Negative", "Neutral"], rows: v.byEntity.map((r) => [r.name, r.positive, r.negative, r.neutral]) }}>
              <DrillTableK
                columns={[{ label: "Name" }, { label: "Positive" }, { label: "Negative" }, { label: "Neutral" }]}
                rows={v.byEntity.map((r) => [
                  { v: r.name, drill: { ...base, entity: r.key, title: `${r.name} · ${range}` } },
                  ...SENTIMENTS.map((s) => ({ v: r[s].toLocaleString("en-US"), drill: { ...base, entity: r.key, sentiment: s, title: `${SENTIMENT_LABEL[s]} · ${r.name}` } })),
                ])}
              />
            </Widget>
            <Widget
              id="cx-reports.sentiment.by-media"
              title="Overall Sentiment Analysis By Media Type (%)"
              actions={<ParamSelect param="mt" value={v.byMedia.entity} options={entOptions} label="Scope" />}
              table={{ columns: ["Media type", "Positive %", "Negative %", "Neutral %", "Conversations"], rows: v.byMedia.rows.map((r) => [mediaLabel(r.mediaType), Math.round(r.pctPositive * 10) / 10, Math.round(r.pctNegative * 10) / 10, Math.round(r.pctNeutral * 10) / 10, r.total]) }}
            >
              <ColumnChartK
                data={v.byMedia.rows.map((r) => ({ key: r.mediaType, positive: r.positive, negative: r.negative, neutral: r.neutral }))}
                catLabels={Object.fromEntries(v.byMedia.rows.map((r) => [r.mediaType, mediaLabel(r.mediaType)]))}
                mode="percent"
                series={sentSeries}
                drill={{ base: { ...base, entity: ent(v.byMedia.entity) }, series: "sentiment", x: "mediaType" }}
                yLabel="% of conversations"
                height={320}
              />
            </Widget>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {(["positive", "negative"] as const).map((s) => (
              <Widget
                key={s}
                id={`cx-reports.sentiment.cloud-${s}`}
                title={`${SENTIMENT_LABEL[s]} Word Cloud`}
                info="Words by the number of conversations that use them. Your topics' own keywords are left out."
                actions={<ParamSelect param="wc" value={v.clouds.entity} options={entOptions} label="Scope" />}
                table={{ columns: ["Word", "Conversations"], rows: v.clouds[s].map((w) => [w.word, w.count]) }}
              >
                <WordCloudK words={v.clouds[s]} tone={s} drill={{ ...base, entity: ent(v.clouds.entity), sentiment: s, titlePrefix: SENTIMENT_LABEL[s] }} empty={`No ${s} conversations with enough text in this period.`} />
              </Widget>
            ))}
          </div>

          <Widget
            id="cx-reports.sentiment.trends"
            title="Sentiment Current Trends"
            info="The 7 days ending on the report's end date, and the two weeks before. Each % compares with the next older 7 days."
            table={{ columns: ["Date range", "Positive", "Positive %", "Negative", "Negative %", "Neutral", "Neutral %"], rows: v.trends.map((t) => [`${t.label} (${rangeLabel(t.range)})`, ...SENTIMENTS.flatMap((s) => [t.counts[s], t.change[s] == null ? null : Math.round(t.change[s]! * 100) / 100])]) }}
          >
            <DrillTableK
              columns={[{ label: "Date range" }, { label: "Positive" }, { label: "Negative" }, { label: "Neutral" }]}
              rows={v.trends.map((t) => [
                { v: `${t.label} (${rangeLabel(t.range)})`, drill: { ...base, window: t.range, title: `${t.label} · ${rangeLabel(t.range)}` } },
                ...SENTIMENTS.map((s) => ({
                  v: (
                    <span className="inline-flex items-center gap-2">
                      {t.counts[s].toLocaleString("en-US")}
                      <Change value={t.change[s]} upIsGood={s !== "negative"} />
                    </span>
                  ),
                  drill: { ...base, window: t.range, sentiment: s, title: `${SENTIMENT_LABEL[s]} · ${rangeLabel(t.range)}` },
                })),
              ])}
            />
          </Widget>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {(["positive", "negative"] as const).map((s) => (
              <Widget
                key={s}
                id={`cx-reports.sentiment.top-${s}`}
                title={`Top ${SENTIMENT_LABEL[s]} Posts`}
                info="Strongest sentiment score first, then engagement, then newest."
                actions={<ParamSelect param="tp" value={v.top.entity} options={entOptions} label="Scope" />}
                table={{ columns: ["Date", "Author", "Text"], rows: v.top[s].map((p) => [dmy(p.at), p.author, p.title || p.text]) }}
              >
                <PostListK posts={v.top[s]} drill={{ ...base, entity: ent(v.top.entity) }} empty={`No ${s} posts in this period.`} />
              </Widget>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Widget
              id="cx-reports.sentiment.brand-pie"
              title="Sentiment Analysis By Brand"
              actions={<ParamSelect param="bp" value={v.brandPie.entity} options={entOptions} label="Scope" />}
              table={{ columns: ["Sentiment", "Conversations"], rows: SENTIMENTS.map((s) => [SENTIMENT_LABEL[s], v.brandPie.counts[s]]) }}
            >
              <PieChartK slices={SENTIMENTS.map((s) => ({ key: s, label: SENTIMENT_LABEL[s], value: v.brandPie.counts[s], color: SENTIMENT_COLOR[s] }))} drill={{ base: { ...base, entity: ent(v.brandPie.entity) }, series: "sentiment" }} height={280} />
            </Widget>
          </div>
        </>
      )}
    </ReportFrame>
  );
}
