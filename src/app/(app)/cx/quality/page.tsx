import { ClipboardCheck } from "lucide-react";
import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { aiConfigured } from "@/lib/cx/ai";
import { cxContext } from "@/lib/cx/context";
import { agentQaStats, coachingView, listCoaching, listReviews, listScorecards, reviewableTickets } from "@/lib/cx/insights/quality";
import { earlyWarnings } from "@/lib/cx/insights/metrics";
import { BulkAiScoreButton, CoachingPanel } from "@/components/cx/insights/coaching-panel";
import { agentsOf, listTeams } from "@/lib/cx/insights/team";
import { num } from "@/lib/format";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { TrendChart } from "@/components/charts/trend-chart";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { Bar } from "@/components/ui/progress";
import { TabsNav } from "@/components/ui/tabs";
import { BrandMeta, NoBrand, cxHref } from "@/components/cx/insights/common";
import { ReviewableTickets, ReviewsTable, SamplePanel } from "@/components/cx/insights/qa-panels";
import { ScorecardsPanel } from "@/components/cx/insights/scorecard-editor";

export const metadata: Metadata = { title: "Quality assessment" };
const ser = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export default async function QualityPage({ searchParams }: PageProps<"/cx/quality">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Quality assessment" />;
  const tab = typeof sp.tab === "string" ? sp.tab : "overview";
  const [scorecards, reviews, stats] = await Promise.all([listScorecards(brand.id), listReviews(brand.id), agentQaStats(brand.id, 90)]);
  const done = reviews.filter((r) => ["submitted", "disputed", "resolved"].includes(r.status));
  const queued = reviews.filter((r) => r.status === "queued" || r.status === "draft");
  const disputes = reviews.filter((r) => r.status === "disputed");
  const scored = done.filter((r) => r.score != null);
  const avg = scored.length ? scored.reduce((s, r) => s + (r.score ?? 0), 0) / scored.length : null;
  const passMap = new Map(scorecards.map((s) => [s.id, s.pass_score]));
  const passRate = scored.length ? (scored.filter((r) => (r.score ?? 0) >= (passMap.get(r.scorecard_id ?? "") ?? 80)).length / scored.length) * 100 : null;
  const active = scorecards.filter((s) => s.active && s.form_type !== "coaching").map((s) => ({ id: s.id, name: s.name }));
  const passDefault = scorecards.find((s) => s.form_type !== "coaching" && s.active)?.pass_score ?? 80;
  const warned = stats.agents.map((a) => ({ a, w: earlyWarnings(stats.trendAll.map((r) => r[a.id ?? "none"] as number | null), passDefault) })).filter((x) => x.w.flags.length);
  const h = (t: string) => cxHref("/cx/quality", brand.id, { tab: t });

  let body: React.ReactNode;
  if (tab === "scorecards") {
    const teams = await listTeams(brand.id);
    body = <ScorecardsPanel brand={brand.id} scorecards={ser(scorecards)} teams={teams.map((t) => ({ id: t.id, name: t.name }))} />;
  } else if (tab === "coaching") {
    const [view, sessions, agents] = await Promise.all([coachingView(brand.id), listCoaching(brand.id), agentsOf(brand.id)]);
    body = (
      <CoachingPanel
        brand={brand.id}
        agents={ser(view)}
        sessions={ser(sessions)}
        forms={scorecards.filter((s) => s.form_type === "coaching" && s.active).map((s) => ({ id: s.id, name: s.name }))}
        supervisors={agents.filter((a) => a.role === "admin" || a.role === "supervisor").map((a) => ({ id: a.id, name: a.name }))}
      />
    );
  }
  else if (tab === "queue") {
    const [tickets, agents, channels] = await Promise.all([
      reviewableTickets(brand.id),
      agentsOf(brand.id),
      query<{ k: string }>("SELECT DISTINCT channel_kind AS k FROM cx_tickets WHERE project_id=$1 ORDER BY 1", [brand.id]),
    ]);
    body = !active.length ? (
      <Card><EmptyState icon={<ClipboardCheck className="h-5 w-5" />} title="Create a scorecard first" description="Reviews score a conversation against a scorecard." action={<ButtonLink href={h("scorecards")} variant="primary">Set up scorecards</ButtonLink>} /></Card>
    ) : (
      <div className="space-y-4">
        {aiConfigured() && <BulkAiScoreButton brand={brand.id} queued={queued.length} />}
        <SamplePanel brand={brand.id} scorecards={active} agents={agents.map((a) => ({ id: a.id, name: a.name }))} channels={channels.map((c) => c.k)} />
        <ReviewsTable brand={brand.id} rows={ser(queued)} title={`Review queue (${queued.length})`} empty="Nothing queued. Sample tickets above or pick one below." />
        <ReviewableTickets brand={brand.id} tickets={ser(tickets)} scorecards={active} />
      </div>
    );
  } else if (tab === "reviews") body = <ReviewsTable brand={brand.id} rows={ser(done)} title={`Completed reviews (${done.length})`} empty="No completed reviews yet." />;
  else if (tab === "disputes") body = <ReviewsTable brand={brand.id} rows={ser(disputes)} title={`Open disputes (${disputes.length})`} empty="No open disputes." />;
  else
    body = (
      <>
        <Card className="mb-4">
          <CardBody className="py-4">
            <MetricStrip>
              <Metric label="Average QA score" value={avg == null ? "n/a" : `${avg.toFixed(0)}%`} sub={`${scored.length} scored reviews`} />
              <Metric label="Pass rate" value={passRate == null ? "n/a" : `${passRate.toFixed(0)}%`} sub="At or above the scorecard pass score" />
              <Metric label="Fatal errors" value={num(done.filter((r) => r.fatal).length)} sub={done.length ? `${((done.filter((r) => r.fatal).length / done.length) * 100).toFixed(0)}% of reviews` : undefined} />
              <Metric label="Open disputes" value={num(disputes.length)} href={h("disputes")} />
              <Metric label="In queue" value={num(queued.length)} href={h("queue")} />
            </MetricStrip>
          </CardBody>
        </Card>
        {warned.length > 0 && (
          <Callout tone="warning" className="mb-4" title={`Early warning: ${warned.length} agent${warned.length > 1 ? "s" : ""}`} action={<ButtonLink size="sm" href={h("coaching")}>Coaching view</ButtonLink>}>
            {warned.map((x) => `${x.a.name} (${x.w.flags.map((f) => (f === "declining" ? "declining 3 weeks" : "below pass 2 weeks")).join(", ")})`).join(" · ")}
          </Callout>
        )}
        {!done.length ? (
          <Card>
            <EmptyState icon={<ClipboardCheck className="h-5 w-5" />} title="No reviews yet" description={scorecards.length ? "Sample solved tickets or pick one to review; agent scorecards and trends appear here." : "Create a scorecard, then review solved conversations."} action={<ButtonLink href={h(scorecards.length ? "queue" : "scorecards")} variant="primary">{scorecards.length ? "Go to review queue" : "Create a scorecard"}</ButtonLink>} />
          </Card>
        ) : (
          <Grid cols={2}>
            <Card>
              <CardHeader title="Agent scorecards" description="Last 90 days" />
              <CardBody>
                <MiniTable
                  columns={[{ header: "Agent" }, { header: "Reviews", align: "right" }, { header: "Avg score" }, { header: "Fatal", align: "right" }, { header: "Disputes", align: "right" }]}
                  rows={stats.agents.map((a) => [
                    <span key="n" className="font-medium text-text">{a.name}</span>,
                    num(a.n),
                    <div key="s" className="flex min-w-32 items-center gap-2"><Bar value={a.avg ?? 0} className="flex-1" /><span className="w-10 text-right tabular-nums">{a.avg == null ? "n/a" : `${a.avg.toFixed(0)}%`}</span></div>,
                    a.fatalRate == null ? "n/a" : `${a.fatalRate.toFixed(0)}%`,
                    num(a.disputes),
                  ])}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Score trend by agent" description="Weekly average QA score" />
              <CardBody>
                {stats.trend.length >= 2 ? (
                  <TrendChart data={stats.trend} xKey="week" xFormat="day" series={stats.trendSeries} yFormat="percent" yDomain={[0, 100]} height={220} />
                ) : (
                  <p className="py-12 text-center text-[13px] text-text-3">The trend appears once reviews span two or more weeks.</p>
                )}
              </CardBody>
            </Card>
          </Grid>
        )}
      </>
    );

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX", href: cxHref("/cx", brand.id) }, { label: "Quality assessment" }]}
        title="Quality assessment"
        subject={brand.name}
        description="Score agent conversations with weighted scorecards, coach, and handle disputes."
        meta={
          <BrandMeta switcher={switcher} current={brand.id}>
            <Badge tone={aiConfigured() ? "good" : "neutral"}>{aiConfigured() ? "AI pre-scoring available" : "Manual scoring"}</Badge>
          </BrandMeta>
        }
      />
      {!aiConfigured() && tab === "overview" && <Callout className="mb-4" title="Connect an AI key for pre-scoring">Reviews are fully manual now. With an AI key (Anthropic, OpenAI, Gemini or Sarvam) configured, a model suggests an answer and a reason for every criterion; the reviewer still decides.</Callout>}
      <TabsNav
        className="mb-4"
        items={[
          { href: h("overview"), label: "Overview" },
          { href: h("queue"), label: "Review queue", count: queued.length },
          { href: h("reviews"), label: "Reviews", count: done.length },
          { href: h("disputes"), label: "Disputes", count: disputes.length },
          { href: h("coaching"), label: "Coaching" },
          { href: h("scorecards"), label: "Forms", count: scorecards.length },
        ]}
      />
      {body}
    </Page>
  );
}
