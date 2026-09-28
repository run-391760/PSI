import { MessageSquareHeart } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { csat, nps } from "@/lib/cx/insights/metrics";
import { csatScores, npsScores } from "@/lib/cx/insights/overview";
import { KIND_META, listSurveys } from "@/lib/cx/insights/surveys";
import { dateLabel, num, timeAgo } from "@/lib/format";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { BrandMeta, NoBrand, cxHref } from "@/components/cx/insights/common";
import { SurveyEditor } from "@/components/cx/insights/survey-editor";

export const metadata: Metadata = { title: "Surveys" };

export default async function SurveysPage({ searchParams }: PageProps<"/cx/surveys">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Surveys" />;
  const now = new Date(), from = new Date(now.getTime() - 90 * 86400000), prev = new Date(from.getTime() - 90 * 86400000);
  const [surveys, cs, csPrev, np, npPrev] = await Promise.all([listSurveys(brand.id), csatScores(brand.id, from, now), csatScores(brand.id, prev, from), npsScores(brand.id, from, now), npsScores(brand.id, prev, from)]);
  const c = csat(cs), cp = csat(csPrev), n = nps(np), npv = nps(npPrev);
  const total = surveys.reduce((s, x) => s + x.responses, 0);
  const pts = (a: number | null, b: number | null) => (a == null || b == null ? null : `${a - b >= 0 ? "+" : ""}${(a - b).toFixed(1)} vs previous 90 days`);

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX", href: cxHref("/cx", brand.id) }, { label: "Surveys" }]}
        title="Surveys"
        subject={brand.name}
        description="CSAT, NPS and custom feedback surveys with public links, per-ticket links and automatic sending after tickets are solved."
        meta={<BrandMeta switcher={switcher} current={brand.id}><Badge>Last 90 days</Badge></BrandMeta>}
        actions={<SurveyEditor brand={brand.id} />}
      />
      <Card className="mb-4">
        <CardBody className="py-4">
          <MetricStrip>
            <Metric label="CSAT" value={c.score == null ? "n/a" : `${c.score.toFixed(0)}%`} sub={c.score == null ? "No ratings yet" : `${c.n} ratings · avg ${c.average?.toFixed(2)} / 5`} info="Share of 4–5 ratings (CSAT surveys plus ticket ratings)." />
            <Metric label="NPS" value={n.score == null ? "n/a" : n.score.toFixed(0)} sub={n.score == null ? "No NPS responses yet" : pts(n.score, npv.score) ?? `${n.n} responses`} info="% promoters (9–10) − % detractors (0–6)." />
            <Metric label="Promoters / detractors" value={n.n ? `${n.promoters} / ${n.detractors}` : "n/a"} sub={n.n ? `${n.passives} passives` : undefined} />
            <Metric label="CSAT trend" value={pts(c.score, cp.score) ? `${(c.score! - cp.score!) >= 0 ? "+" : ""}${(c.score! - cp.score!).toFixed(1)} pts` : "n/a"} sub="vs previous 90 days" />
            <Metric label="Responses (all time)" value={num(total)} sub={`${surveys.length} survey${surveys.length === 1 ? "" : "s"}`} />
          </MetricStrip>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Your surveys" />
        {surveys.length === 0 ? (
          <EmptyState icon={<MessageSquareHeart className="h-5 w-5" />} title="No surveys yet" description="Create a CSAT or NPS survey, share its public link or send a personal link per ticket. Responses and scores appear here." action={<SurveyEditor brand={brand.id} />} />
        ) : (
          <CardBody className="pt-1">
            <div className="divide-y divide-border">
              {surveys.map((s) => {
                const score = s.kind === "nps" ? nps(s.scores).score : s.kind === "csat" ? csat(s.scores).score : null;
                return (
                  <Link key={s.id} href={cxHref(`/cx/surveys/${s.id}`, brand.id)} className="-mx-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-2 py-3 hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-text">{s.name}</span>
                        <Badge tone="brand">{KIND_META[s.kind].label}</Badge>
                        {s.status === "paused" && <Badge tone="warning">Paused</Badge>}
                        {s.auto_send && <Badge tone="info">Auto-send</Badge>}
                      </div>
                      <div className="truncate text-[12px] text-text-3">{s.question || `${s.questions.length} questions`} · created {dateLabel(s.created_at)}</div>
                    </div>
                    <div className="text-right text-[13px]">
                      <div className="font-semibold text-text">{score == null ? "n/a" : s.kind === "nps" ? score.toFixed(0) : `${score.toFixed(0)}%`}</div>
                      <div className="text-[12px] text-text-3">{s.kind === "custom" ? "custom" : `${KIND_META[s.kind].label}, 90 days`}</div>
                    </div>
                    <div className="w-28 text-right text-[13px]">
                      <div className="font-semibold text-text">{num(s.responses)}</div>
                      <div className="text-[12px] text-text-3">{s.last_response ? `last ${timeAgo(s.last_response)}` : "no responses"}</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardBody>
        )}
      </Card>
    </Page>
  );
}
