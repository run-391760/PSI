import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { cxContext } from "@/lib/cx/context";
import { KIND_META, agentSurveyReport, appOrigin, getSurvey, listInvites, listResponses, surveyStats } from "@/lib/cx/insights/surveys";
import { getClassificationTree, getFieldDefs } from "@/lib/cx/admin/fields";
import { query } from "@/lib/db";
import { MiniTable } from "@/components/ui/mini-table";
import { AgentReportCsv, SurveySettingsButton } from "@/components/cx/insights/survey-settings";
import { num } from "@/lib/format";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { BarChart } from "@/components/charts/bar-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { DistributionBar } from "@/components/ui/progress";
import { BrandMeta, NoBrand, cxHref } from "@/components/cx/insights/common";
import { SurveyEditor } from "@/components/cx/insights/survey-editor";
import { SurveyResponsesTable, SurveySharePanel } from "@/components/cx/insights/survey-panels";

export const metadata: Metadata = { title: "Survey" };

export default async function SurveyPage({ params, searchParams }: PageProps<"/cx/surveys/[id]">) {
  const user = await requirePageUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Surveys" />;
  const survey = await getSurvey(brand.id, id).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const [rows, invites, h, agentRows, defs, tree, chans] = await Promise.all([
    listResponses(brand.id, id),
    listInvites(brand.id, id),
    headers(),
    agentSurveyReport(brand.id, id, 90),
    getFieldDefs(brand.id).catch(() => []),
    getClassificationTree(brand.id).catch(() => []),
    query<{ k: string }>("SELECT DISTINCT channel_kind AS k FROM cx_tickets WHERE project_id=$1 ORDER BY 1", [brand.id]),
  ]);
  const origin = appOrigin() || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost"}`;
  const s = surveyStats(survey, rows, 90);
  const scoreLabel = survey.kind === "nps" ? "NPS" : survey.kind === "csat" ? "CSAT" : "Average score";
  const score = survey.kind === "nps" ? s.nps.score : survey.kind === "csat" ? s.csat.score : s.avg;
  const fmtScore = score == null ? "n/a" : survey.kind === "csat" ? `${score.toFixed(0)}%` : survey.kind === "nps" ? score.toFixed(0) : score.toFixed(2);
  const commented = s.sentiment.positive + s.sentiment.neutral + s.sentiment.negative;
  const hasScale = survey.kind !== "custom" || survey.questions.some((q) => q.type === "rating5" || q.type === "nps");
  const answered = invites.filter((i) => i.responded_at).length;

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX", href: cxHref("/cx", brand.id) }, { label: "Surveys", href: cxHref("/cx/surveys", brand.id) }, { label: survey.name }]}
        title={survey.name}
        subject={KIND_META[survey.kind].label}
        description={survey.question || undefined}
        meta={
          <BrandMeta switcher={switcher} current={brand.id}>
            <Badge tone={survey.status === "active" ? "good" : "warning"}>{survey.status === "active" ? "Collecting responses" : "Paused"}</Badge>
            {survey.auto_send && <Badge tone="info">Auto-send on</Badge>}
            <Badge>Last 90 days</Badge>
          </BrandMeta>
        }
        actions={
          <>
            <SurveySettingsButton
              brand={brand.id}
              surveyId={survey.id}
              kind={survey.kind}
              question={survey.question}
              settings={survey.settings}
              channels={chans.map((c) => c.k)}
              classifications={tree.filter((n) => !n.hidden).map((n) => ({ id: n.id, label: n.label }))}
              fields={defs.filter((f) => f.scope === "ticket" && !f.hidden).map((f) => ({ key: f.key, label: f.label }))}
            />
            <SurveyEditor brand={brand.id} survey={survey} />
          </>
        }
      />
      <Card className="mb-4">
        <CardBody className="py-4">
          <MetricStrip>
            <Metric label={scoreLabel} value={fmtScore} sub={survey.kind === "csat" && s.csat.average != null ? `avg ${s.csat.average.toFixed(2)} / 5` : survey.kind === "nps" && s.nps.n ? `${s.nps.promoters} promoters · ${s.nps.detractors} detractors` : undefined} />
            <Metric label="Responses" value={num(s.n)} sub={`${num(rows.length)} all time`} />
            <Metric label="Response rate (personal links)" value={invites.length ? `${((answered / invites.length) * 100).toFixed(0)}%` : "n/a"} sub={invites.length ? `${answered} of ${invites.length} links answered` : "No personal links yet"} />
            <Metric label="Comments" value={num(commented)} sub={commented ? `${s.sentiment.negative} negative` : "No comments yet"} />
          </MetricStrip>
        </CardBody>
      </Card>
      <Grid cols={3} className="mb-4">
        <Card className="xl:col-span-2">
          <CardHeader title={`${scoreLabel} trend`} description="Weekly score, last 90 days" />
          <CardBody>
            {hasScale && s.trend.filter((t) => t.score != null).length >= 2 ? (
              <TrendChart data={s.trend} xKey="day" xFormat="day" series={[{ key: "score", label: `${scoreLabel} (week of)` }]} yFormat={survey.kind === "csat" ? "percent" : "raw"} height={220} />
            ) : (
              <p className="py-16 text-center text-[13px] text-text-3">{s.n ? `All ${s.n} scored responses fall in one week (${fmtScore}). The weekly trend appears once responses span two or more weeks.` : "The trend appears after the first scored responses."}</p>
            )}
          </CardBody>
        </Card>
        <SurveySharePanel brand={brand.id} survey={survey} origin={origin} invites={invites} />
      </Grid>
      {s.n > 0 && (
        <Grid cols={2} className="mb-4">
          {hasScale && survey.kind !== "custom" && (
            <Card>
              <CardHeader title="Score distribution" />
              <CardBody>
                <BarChart data={s.distribution} xKey="score" series={[{ key: "count", label: "Responses" }]} height={200} valueLabels />
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Comment sentiment" description="Built-in sentiment analysis of written comments" />
            <CardBody>
              {commented ? (
                <DistributionBar
                  segments={[
                    { label: "Positive", value: s.sentiment.positive, color: "var(--good)" },
                    { label: "Neutral", value: s.sentiment.neutral, color: "var(--text-3)" },
                    { label: "Negative", value: s.sentiment.negative, color: "var(--critical)" },
                  ]}
                />
              ) : (
                <p className="py-6 text-center text-[13px] text-text-3">No written comments yet.</p>
              )}
            </CardBody>
          </Card>
        </Grid>
      )}
      <Card className="mb-4">
        <CardHeader title="Agent-wise CSAT sent" description="Per ticket assignee, last 90 days: survey links created, delivered by email/reply, answered, and scores." actions={agentRows.length ? <AgentReportCsv name={survey.name} rows={agentRows} /> : undefined} />
        <CardBody className="pt-1">
          <MiniTable
            empty="No survey links sent yet."
            columns={[{ header: "Agent" }, { header: "Sent", align: "right" }, { header: "Delivered", align: "right" }, { header: "Responses", align: "right" }, { header: "Response rate", align: "right" }, { header: "Avg score", align: "right" }, { header: "Satisfied", align: "right" }]}
            rows={agentRows.map((r) => [<span key="a" className="font-medium text-text">{r.agent}</span>, num(r.invites), num(r.delivered), num(r.responses), r.responseRate == null ? "n/a" : `${r.responseRate.toFixed(0)}%`, r.avg == null ? "n/a" : r.avg.toFixed(2), r.satisfiedPct == null ? "n/a" : `${r.satisfiedPct.toFixed(0)}%`])}
          />
        </CardBody>
      </Card>
      <SurveyResponsesTable brand={brand.id} survey={survey} rows={rows} />
    </Page>
  );
}
