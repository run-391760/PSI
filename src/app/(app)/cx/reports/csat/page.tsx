import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { reportContext } from "@/lib/cx/reports/data";
import { csatReportView, engagementBase } from "@/lib/cx/reports/engagement";
import { BAND_COLOR, BAND_LABEL, BANDS } from "@/lib/cx/reports/engagement-model";
import { dmy, rangeLabel, type DrillSpec } from "@/lib/cx/reports/model";
import { NoBrand } from "@/components/cx/insights/common";
import { ReportEmpty, ReportFrame } from "@/components/cx/reports/frame";
import { DrillButton } from "@/components/cx/reports/drill-button";
import { ColumnChartK, DrillTableK, IntervalSelect, LineChartK, ParamSelect, PieChartK, TileRow, Widget, type KCell, type Tile } from "@/components/cx/reports/kit";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "CSAT Report" };
type SP = Record<string, string | string[] | undefined>;

const ticketHref = (brand: string, id: string) => `/cx/ticket/${id}?brand=${encodeURIComponent(brand)}`;
const fmtPct = (v: number | null) => (v == null ? "n/a" : `${v.toFixed(1)} %`);

export default async function CsatReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="CSAT Report" />;
  const ctx = await reportContext(brand, sp);
  const v = await csatReportView(ctx, sp);
  const base = engagementBase(ctx, "surveys", { dims: v.drillDims });
  const range = rangeLabel(ctx.filters.range);
  const drill = (dims: Record<string, string>, label: string): DrillSpec => ({ ...base, dims: { ...v.drillDims, ...dims }, title: `${v.selectedName} · ${label} · ${range}` });
  const bandSeries = BANDS.map((b) => ({ key: b, label: BAND_LABEL[b], color: BAND_COLOR[b] }));
  const s = v.summary;
  const npsBase: DrillSpec = { ...base, dims: { kind: "nps" }, title: `NPS responses · ${range}` };
  const npsSeries = [
    { key: "promoter", label: "Promoters (9–10)", color: "var(--good)", value: v.nps.promoters },
    { key: "passive", label: "Passives (7–8)", color: "var(--text-3)", value: v.nps.passives },
    { key: "detractor", label: "Detractors (0–6)", color: "var(--critical)", value: v.nps.detractors },
  ];
  const picker =
    v.surveys.length > 0 ? (
      <ParamSelect
        param="survey"
        value={v.selected}
        label="Survey"
        className="w-52"
        options={[{ value: "", label: "All CSAT surveys" }, ...v.surveys.map((x) => ({ value: x.id, label: x.paused ? `${x.name} (paused)` : x.name }))]}
      />
    ) : null;

  const tiles: Tile[] = [
    { key: "responses", label: "Responses", value: s.responses.toLocaleString("en-US"), change: v.change.responses, drill: drill({}, "Responses") },
    { key: "average", label: "Average CSAT", value: s.average == null ? "n/a" : <>{s.average.toFixed(2)}<span className="text-[15px] text-text-3"> / 5</span></>, change: v.change.average, info: "Mean of 1–5 scores", drill: s.scored ? drill({}, "Responses") : null },
    { key: "satisfied", label: "Satisfied (4–5)", value: fmtPct(s.satisfiedPct), change: v.change.satisfied, seriesKey: "satisfied", info: `${s.bands.satisfied.toLocaleString("en-US")} of ${s.scored.toLocaleString("en-US")} scored responses`, drill: s.bands.satisfied ? drill({ band: "satisfied" }, "Satisfied") : null },
    ...(v.hasNps
      ? [{ key: "nps", label: "NPS", value: v.nps.score == null ? "n/a" : (v.nps.score > 0 ? "+" : "") + v.nps.score.toFixed(1), info: `All NPS surveys: ${v.nps.promoters} promoters, ${v.nps.passives} passives, ${v.nps.detractors} detractors`, drill: v.npsResponses ? npsBase : null } satisfies Tile]
      : []),
    { key: "rate", label: "Response rate", value: fmtPct(v.responseRate), info: v.invites ? `${v.responded.toLocaleString("en-US")} of ${v.invites.toLocaleString("en-US")} invites sent in the period were answered` : "No survey invites were sent in the period", drill: null },
  ];

  return (
    <ReportFrame ctx={ctx} switcher={switcher} page="csat" title="CSAT Report" description="Customer satisfaction survey responses, by the date they were submitted." source="Source: stored survey responses" filters={{ scope: false, media: false }} actions={picker}>
      {v.noSurveys ? (
        <ReportEmpty brand={brand.id} kind="surveys" what="The CSAT report shows response volume, average score, satisfaction bands, agent scores and comments once a CSAT survey collects answers." />
      ) : v.empty ? (
        <ReportEmpty brand={brand.id} kind="surveys" what={`No responses to ${v.selected ? `“${v.selectedName}”` : "your CSAT surveys"} were submitted in ${range}.`} />
      ) : (
        <>
          <Widget id="cx-reports.csat.tiles" title={v.selectedName} bare table={{ columns: ["Metric", "Value"], rows: [["Responses", s.responses], ["Average CSAT", s.average], ["Satisfied %", s.satisfiedPct == null ? null : Math.round(s.satisfiedPct * 10) / 10], ...(v.hasNps ? [["NPS", v.nps.score] as [string, number | null]] : []), ["Response rate %", v.responseRate == null ? null : Math.round(v.responseRate * 10) / 10]] }}>
            <TileRow cols={v.hasNps ? 5 : 4} tiles={tiles} />
          </Widget>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[3fr_2fr]">
            <Widget
              id="cx-reports.csat.distribution"
              title="Score Distribution"
              info="Responses per score (1 = very unsatisfied, 5 = very satisfied)."
              table={{ columns: ["Score", "Responses"], rows: v.distribution.map((d) => [d.key, d.count]) }}
              insight={{ metric: "Responses per CSAT score", range, rows: v.distribution.map((d) => ({ key: `Score ${d.key}`, value: d.count })), total: s.scored, previous: null }}
            >
              <ColumnChartK
                data={v.distribution.map((d) => ({ key: d.key, ...Object.fromEntries(BANDS.map((b) => [b, d.band === b ? d.count : 0])) }))}
                catLabels={Object.fromEntries(v.distribution.map((d) => [d.key, `Score ${d.key}`]))}
                series={bandSeries}
                drill={{ base, series: "dims.band", x: "dims.score" }}
                yLabel="Number of responses"
                height={280}
              />
            </Widget>
            <Widget
              id="cx-reports.csat.bands"
              title="Satisfaction"
              table={{ columns: ["Band", "Responses"], rows: BANDS.map((b) => [BAND_LABEL[b], s.bands[b]]) }}
              insight={{ metric: "Responses by satisfaction band", range, rows: BANDS.map((b) => ({ key: BAND_LABEL[b], value: s.bands[b] })), total: s.scored, previous: null }}
            >
              <PieChartK donut centerLabel="Scored" slices={bandSeries.map((b) => ({ ...b, value: s.bands[b.key] }))} drill={{ base, series: "dims.band" }} height={280} labels={false} />
            </Widget>
          </div>

          {v.hasNps && (
            <Widget
              id="cx-reports.csat.nps"
              title="NPS Breakdown"
              info="All NPS surveys in the period: promoters score 9–10, passives 7–8, detractors 0–6. NPS = % promoters − % detractors."
              table={{ columns: ["Group", "Responses"], rows: [...npsSeries.map((x) => [x.label, x.value] as [string, number]), ["NPS", v.nps.score]] }}
              insight={{ metric: "NPS responses by group", range, rows: npsSeries.map((x) => ({ key: x.label, value: x.value })), total: v.nps.n, previous: null }}
            >
              {v.nps.n ? (
                <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-[1fr_1fr]">
                  <PieChartK donut centerLabel="NPS responses" slices={npsSeries} drill={{ base: npsBase, series: "dims.band" }} height={240} labels={false} />
                  <TileRow
                    cols={2}
                    size="md"
                    tiles={[
                      { key: "nps-score", label: "NPS", value: v.nps.score == null ? "n/a" : (v.nps.score > 0 ? "+" : "") + v.nps.score.toFixed(1), drill: npsBase },
                      ...npsSeries.map((x) => ({ key: `nps-${x.key}`, label: x.label, value: x.value.toLocaleString("en-US"), info: `${v.nps.n ? ((x.value / v.nps.n) * 100).toFixed(1) : "0.0"} % of ${v.nps.n.toLocaleString("en-US")}`, drill: x.value ? { ...npsBase, dims: { kind: "nps", band: x.key }, title: `NPS · ${x.label} · ${range}` } : null })),
                    ]}
                  />
                </div>
              ) : (
                <p className="py-10 text-center text-[13px] text-text-3">No NPS responses in this period.</p>
              )}
            </Widget>
          )}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Widget
              id="cx-reports.csat.volume"
              title="Responses Over Time"
              actions={<IntervalSelect value={ctx.filters.interval} />}
              table={{ columns: ["Period", ...bandSeries.map((b) => b.label)], rows: v.trend.map((r) => [dmy(r.key), ...BANDS.map((b) => Number(r[b] ?? 0))]) }}
              insight={{ metric: "Survey responses", range, rows: v.trend.map((r) => ({ key: r.key, value: BANDS.reduce((x, b) => x + Number(r[b] ?? 0), 0) })), total: s.scored, previous: null }}
            >
              <ColumnChartK data={v.trend} series={bandSeries} drill={{ base, series: "dims.band", x: "bucket" }} xFormat="day" interval={ctx.filters.interval} yLabel="Number of responses" height={280} />
            </Widget>
            <Widget
              id="cx-reports.csat.average"
              title="Average CSAT Over Time"
              info="Mean score of the responses in each period. Gaps are periods without scored responses."
              table={{ columns: ["Period", "Average CSAT"], rows: v.trend.map((r) => [dmy(r.key), r.average]) }}
              insight={{ metric: "Average CSAT (1–5)", range, rows: v.trend.map((r) => ({ key: r.key, value: r.average })), total: s.average, previous: null }}
            >
              <LineChartK data={v.trend.map((r) => ({ key: r.key, average: r.average }))} series={[{ key: "average", label: "Average CSAT", color: "var(--series-1)" }]} drill={{ base, x: "bucket" }} interval={ctx.filters.interval} yLabel="Average score (1–5)" height={280} shared={false} legend={false} />
            </Widget>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Widget
              id="cx-reports.csat.agents"
              title="CSAT by Agent"
              info="Agent = the assignee of the ticket the survey was sent for."
              table={{ columns: ["Agent", "Responses", "Average", "Satisfied", "Neutral", "Unsatisfied", "Satisfied %"], rows: v.byAgent.map((a) => [a.name, a.responses, a.average, a.satisfied, a.neutral, a.unsatisfied, a.satisfiedPct == null ? null : Math.round(a.satisfiedPct * 10) / 10]) }}
              insight={{ metric: "Satisfied % per agent", range, rows: v.byAgent.map((a) => ({ key: a.name, value: a.satisfiedPct })), total: s.satisfiedPct, previous: null }}
            >
              <DrillTableK
                columns={[{ label: "Agent" }, { label: "Responses" }, { label: "Avg" }, { label: "Satisfied" }, { label: "Unsatisfied" }, { label: "Satisfied %" }]}
                rows={v.byAgent.map((a): KCell[] => [
                  { v: a.name },
                  { v: a.responses.toLocaleString("en-US"), drill: drill({ agent: a.key }, a.name) },
                  { v: a.average == null ? "n/a" : a.average.toFixed(2) },
                  { v: a.satisfied.toLocaleString("en-US"), drill: a.satisfied ? drill({ agent: a.key, band: "satisfied" }, `${a.name} · Satisfied`) : null },
                  { v: a.unsatisfied.toLocaleString("en-US"), drill: a.unsatisfied ? drill({ agent: a.key, band: "unsatisfied" }, `${a.name} · Unsatisfied`) : null },
                  { v: fmtPct(a.satisfiedPct) },
                ])}
              />
            </Widget>
            <Widget
              id="cx-reports.csat.comments"
              title="Latest Comments"
              table={{ columns: ["Date", "Score", "Ticket", "Comment"], rows: v.comments.map((c) => [dmy(c.at), c.score, c.ticketNumber ? `#${c.ticketNumber}` : null, c.comment]) }}
            >
              {v.comments.length === 0 ? (
                <p className="py-10 text-center text-[13px] text-text-3">No written comments in this period.</p>
              ) : (
                <ul className="max-h-[360px] divide-y divide-border overflow-y-auto pr-1">
                  {v.comments.map((c) => {
                    const tone = c.score == null ? "bg-surface-3 text-text-2" : c.score >= 4 ? "bg-good-soft text-good-ink" : c.score === 3 ? "bg-surface-3 text-text-2" : "bg-critical-soft text-critical-ink";
                    return (
                      <li key={c.id} className="flex gap-3 py-2.5">
                        <DrillButton
                          spec={{ ...base, dims: { id: c.id }, title: `${c.contact ?? "Anonymous"} · Response · ${dmy(c.at)}` }}
                          className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular hover:ring-2 hover:ring-border-strong", tone)}
                          title={c.score == null ? "No score. Click to open the response" : `Score ${c.score} of 5. Click to open the response`}
                        >
                          {c.score ?? "–"}
                        </DrillButton>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-text-3">
                            <span className="font-medium text-text-2">{c.contact ?? "Anonymous"}</span>
                            {c.agent && <span>· {c.agent}</span>}
                            <span className="ml-auto tabular">{dmy(c.at)}</span>
                          </span>
                          <span className="mt-0.5 line-clamp-3 block text-[13px] break-words text-text">{c.comment}</span>
                          {c.ticketId && (
                            <Link href={ticketHref(brand.id, c.ticketId)} className="mt-0.5 inline-block text-[12px] text-link hover:underline">
                              Ticket #{c.ticketNumber}
                            </Link>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Widget>
          </div>
        </>
      )}
    </ReportFrame>
  );
}
