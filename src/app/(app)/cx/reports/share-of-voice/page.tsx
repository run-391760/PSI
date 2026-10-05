import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { reportContext } from "@/lib/cx/reports/data";
import { drillBase, shareOfVoiceView } from "@/lib/cx/reports/listening";
import { dmy, hourLabel, rangeLabel, SENTIMENT_COLOR, SENTIMENT_LABEL, SENTIMENTS } from "@/lib/cx/reports/model";
import { NoBrand } from "@/components/cx/insights/common";
import { ReportEmpty, ReportFrame } from "@/components/cx/reports/frame";
import { ColumnChartK, IntervalSelect, LineChartK, ParamSelect, PieChartK, PostListK, StatsColumn, Widget, WordCloudK } from "@/components/cx/reports/kit";

export const metadata: Metadata = { title: "Share of Voice" };
type SP = Record<string, string | string[] | undefined>;

export default async function ShareOfVoicePage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Share of Voice" />;
  const ctx = await reportContext(brand, sp);
  const v = await shareOfVoiceView(ctx, sp);
  const base = drillBase(ctx);
  const range = rangeLabel(ctx.filters.range);
  const names = Object.fromEntries(v.entities.map((e) => [e.id, e.name]));
  const entSeries = v.entities.map((e) => ({ key: e.id, label: e.name }));
  const entOptions = (all: string) => [{ value: "", label: all }, ...v.entities.map((e) => ({ value: e.id, label: e.name }))];
  const scopeAll = ctx.scope.isDefault ? `All of ${brand.name}` : "All selected";

  return (
    <ReportFrame ctx={ctx} switcher={switcher} page="sov" title="Share of Voice" mediaOptions={v.mediaOptions} filters={{ scope: true, media: true, basis: true }}>
      {v.empty ? (
        <ReportEmpty brand={brand.id} what="Share of Voice compares how many conversations (listening mentions and tickets) each topic, cluster or profile has." />
      ) : (
        <>
          <Widget
            id="cx-reports.sov.buzz"
            title="Buzz Trend"
            actions={
              <>
                <IntervalSelect value={ctx.filters.interval} />
                <ParamSelect param="buzz" value={v.buzz.entity} options={entOptions(scopeAll)} label="Stats for" />
              </>
            }
            table={{ columns: ["Period", ...v.entities.map((e) => e.name)], rows: v.trend.map((r) => [dmy(String(r.key)), ...v.entities.map((e) => Number(r[e.id] ?? 0))]) }}
            insight={{ metric: "Conversations", range, rows: v.trend.map((r) => ({ key: String(r.key), value: v.entities.reduce((s, e) => s + Number(r[e.id] ?? 0), 0) })), total: v.buzz.total, previous: null }}
          >
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
              <StatsColumn
                title={v.buzz.name}
                items={[
                  { label: "Total conversations", value: v.buzz.total.toLocaleString("en-US"), drill: { ...base, entity: v.buzz.entity || undefined, title: `${v.buzz.name} · ${range}` } },
                  { label: "Average per day", value: v.buzz.avgPerDay.toLocaleString("en-US") },
                  { label: "Peak date", value: v.buzz.peakDate ? dmy(v.buzz.peakDate) : "n/a", drill: v.buzz.peakDate ? { ...base, entity: v.buzz.entity || undefined, bucket: v.buzz.peakDate, interval: "day", title: `${v.buzz.name} · ${dmy(v.buzz.peakDate)}` } : null },
                  { label: "Peak time", value: hourLabel(v.buzz.peakHour) },
                ]}
              />
              <LineChartK data={v.trend} series={entSeries} drill={{ base, series: "entity", x: "bucket" }} interval={ctx.filters.interval} yLabel="Number of conversations" height={300} />
            </div>
          </Widget>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Widget
              id="cx-reports.sov.sentiment"
              title="Overall Sentiment Analysis"
              table={{ columns: ["Scope", "Positive", "Negative", "Neutral"], rows: v.sentiment.map((r) => [names[r.key], r.positive, r.negative, r.neutral]) }}
              insight={{ metric: "Conversations by sentiment", range, rows: v.sentiment.flatMap((r) => SENTIMENTS.map((s) => ({ key: `${names[r.key]} ${s}`, value: r[s] }))), total: v.sov.total, previous: null }}
            >
              <ColumnChartK data={v.sentiment} catLabels={names} series={SENTIMENTS.map((s) => ({ key: s, label: SENTIMENT_LABEL[s], color: SENTIMENT_COLOR[s] }))} drill={{ base, series: "sentiment", x: "entity" }} yLabel="Number of conversations" height={300} />
            </Widget>
            <Widget
              id="cx-reports.sov.share"
              title="Relative Share of Voice"
              table={{ columns: ["Scope", "Conversations", "Share %"], rows: v.sov.slices.map((s) => [s.name, s.value, Math.round(s.pct * 100) / 100]) }}
              insight={{ metric: "Share of voice", range, rows: v.sov.slices.map((s) => ({ key: s.name, value: s.value })), total: v.sov.total, previous: null }}
            >
              <PieChartK slices={v.sov.slices.map((s) => ({ key: s.id, label: s.name, value: s.value }))} drill={{ base, series: "entity" }} height={250} />
              <div className="mt-3 grid grid-cols-1 gap-3 border-t border-border pt-3 text-center sm:grid-cols-3">
                {[
                  { label: "Total conversation", value: v.sov.total, sub: "" },
                  { label: "Most talked", value: v.sov.most?.value ?? null, sub: v.sov.most?.name ?? "" },
                  { label: "Least talked", value: v.sov.least?.value ?? null, sub: v.sov.least?.name ?? "" },
                ].map((x) => (
                  <div key={x.label} className="min-w-0">
                    <div className="text-[20px] font-semibold text-text tabular">{x.value == null ? "n/a" : x.value.toLocaleString("en-US")}</div>
                    <div className="truncate text-[11px] font-medium tracking-[0.08em] text-text-2 uppercase" title={x.sub}>
                      {x.label}
                      {x.sub && ` - ${x.sub}`}
                    </div>
                  </div>
                ))}
              </div>
            </Widget>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Widget
              id="cx-reports.sov.posts"
              title="Share of Voice Top Posts"
              info="Most engaged conversations first (likes, comments, shares and points where the source reports them), then the strongest sentiment."
              actions={<ParamSelect param="posts" value={v.posts.entity} options={entOptions(scopeAll)} label="Top posts for" />}
              table={{ columns: ["Date", "Author", "Sentiment", "Text"], rows: v.posts.items.map((p) => [dmy(p.at), p.author, SENTIMENT_LABEL[p.sentiment], p.title || p.text]) }}
            >
              <PostListK posts={v.posts.items} drill={{ ...base, entity: v.posts.entity || undefined }} />
            </Widget>
            <Widget
              id="cx-reports.sov.cloud"
              title="Word Cloud"
              info="Words by the number of conversations that use them. Your topics' own keywords are left out."
              actions={<ParamSelect param="cloud" value={v.cloud.entity} options={entOptions(scopeAll)} label="Words for" />}
              table={{ columns: ["Word", "Conversations"], rows: v.cloud.words.map((w) => [w.word, w.count]) }}
            >
              <WordCloudK words={v.cloud.words} drill={{ ...base, entity: v.cloud.entity || undefined }} />
            </Widget>
          </div>
        </>
      )}
    </ReportFrame>
  );
}
