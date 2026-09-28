import { ArrowRight, CheckCircle2, Circle, ClipboardCheck, Contact, Ear, Inbox, LayoutGrid, MessageSquareHeart, PlugZap, Siren, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { getOverview } from "@/lib/cx/insights/overview";
import { compact, num } from "@/lib/format";
import { humanDuration } from "@/lib/cx/insights/metrics";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { DonutChart } from "@/components/charts/donut-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { BrandMeta, NoBrand, cxHref } from "@/components/cx/insights/common";

export const metadata: Metadata = { title: "CX Overview" };

const RANGES = [7, 30, 90];
const dur = humanDuration;
const pts = (cur: number | null, prev: number | null, unit = " pts") => (cur == null || prev == null ? null : `${cur - prev >= 0 ? "+" : ""}${(cur - prev).toFixed(1)}${unit} vs prev.`);

export default async function CxOverviewPage({ searchParams }: PageProps<"/cx">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="CX Overview" />;
  const days = RANGES.includes(Number(sp.range)) ? Number(sp.range) : 30;
  const o = await getOverview(brand.id, days);
  const k = o.kpis;
  const href = (p: string, extra: Record<string, string> = {}) => cxHref(p, brand.id, extra);

  const checklist = [
    { done: o.setup.channels > 0, label: "Connect a channel", hint: "Email, live chat, web form or social accounts", href: href("/cx/settings/channels") },
    { done: o.setup.topics > 0, label: "Add a listening topic", hint: "Track mentions of your brand and competitors", href: href("/cx/listening/topics") },
    { done: o.setup.members > 0, label: "Invite your team", hint: "Agents, supervisors and viewers", href: href("/cx/settings/team") },
    { done: o.setup.policies > 0, label: "Set SLA targets", hint: "First response and resolution per priority", href: href("/cx/settings/team", { tab: "sla" }) },
    { done: o.setup.surveys > 0, label: "Create a survey", hint: "CSAT or NPS after conversations", href: href("/cx/surveys") },
    { done: o.setup.scorecards > 0, label: "Create a QA scorecard", hint: "Review conversation quality", href: href("/cx/quality", { tab: "scorecards" }) },
  ];
  const doneCount = checklist.filter((c) => c.done).length;
  const quick = [
    { label: "Inbox", icon: Inbox, href: href("/cx/inbox") },
    { label: "Mentions", icon: Ear, href: href("/cx/listening") },
    { label: "Crisis", icon: Siren, href: href("/cx/crisis") },
    { label: "Contacts", icon: Contact, href: href("/cx/contacts") },
    { label: "Dashboards", icon: LayoutGrid, href: href("/cx/dashboards") },
    { label: "Surveys", icon: MessageSquareHeart, href: href("/cx/surveys") },
    { label: "Quality", icon: ClipboardCheck, href: href("/cx/quality") },
    { label: "Team & SLAs", icon: Users, href: href("/cx/settings/team") },
  ];

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX" }, { label: "Overview" }]}
        title="CX Overview"
        subject={brand.name}
        description="Service performance, customer feedback and brand conversation — computed from your stored tickets, messages, mentions and survey responses."
        meta={
          <BrandMeta switcher={switcher} current={brand.id}>
            <Badge tone="neutral">Last {days} days vs previous {days}</Badge>
          </BrandMeta>
        }
        actions={
          <div className="flex rounded-md border border-border-strong bg-surface p-0.5">
            {RANGES.map((r) => (
              <Link key={r} href={href("/cx", { range: String(r) })} className={`rounded px-2.5 py-1 text-[12.5px] font-medium ${r === days ? "bg-brand-soft text-brand-ink" : "text-text-2 hover:text-text"}`}>
                {r}d
              </Link>
            ))}
          </div>
        }
      />

      {doneCount < checklist.length && (
        <Card className="mb-4">
          <CardHeader title="Set up your CX workspace" description={`${doneCount} of ${checklist.length} steps done. Metrics fill in as real conversations, mentions and responses arrive.`} />
          <CardBody className="grid gap-2 pt-1 sm:grid-cols-2 xl:grid-cols-3">
            {checklist.map((c) => (
              <Link key={c.label} href={c.href} className="flex items-start gap-2.5 rounded-md border border-border px-3 py-2.5 hover:bg-surface-2">
                {c.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good-ink" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-text-3" />}
                <span className="min-w-0">
                  <span className={`block text-[13px] font-medium ${c.done ? "text-text-2 line-through" : "text-text"}`}>{c.label}</span>
                  <span className="block text-[12px] text-text-3">{c.hint}</span>
                </span>
              </Link>
            ))}
          </CardBody>
        </Card>
      )}

      <Card className="mb-4">
        <CardBody className="py-4">
          <MetricStrip>
            <Metric label="Open tickets" value={num(k.open)} href={href("/cx/inbox")} sub={k.open ? `${k.urgent} high/urgent · ${k.overdue} overdue` : "Nothing waiting"} />
            <Metric label="New today" value={num(k.newToday)} delta={k.newTodayDelta} deltaLabel="vs yesterday" upIsGood={false} sub={`${num(k.newYesterday)} yesterday`} />
            <Metric label="Avg first response" value={dur(k.frt)} delta={k.frtDelta} upIsGood={false} info="Mean time from ticket creation to the first agent reply, for tickets created in the period." />
            <Metric label="Avg resolution" value={dur(k.art)} delta={k.artDelta} upIsGood={false} info="Mean time from creation to resolution, for tickets resolved in the period." />
            <Metric label="SLA compliance" value={k.sla == null ? "n/a" : `${k.sla.toFixed(0)}%`} sub={pts(k.sla, k.slaPrev) ?? (k.sla == null ? "No decided SLA targets" : `${k.slaDetail.met} met · ${k.slaDetail.breached} breached`)} info="Share of first-response and resolution targets met, among targets that are met or already breached." />
          </MetricStrip>
          <div className="my-4 border-t border-border" />
          <MetricStrip>
            <Metric label="CSAT" value={k.csat == null ? "n/a" : `${k.csat.toFixed(0)}%`} sub={k.csat == null ? "No ratings yet" : `${k.csatN} ratings · ${pts(k.csat, k.csatPrev) ?? "no previous data"}`} href={href("/cx/surveys")} info="Share of 4–5 ratings on the 1–5 scale (surveys and ticket ratings)." />
            <Metric label="NPS" value={k.nps == null ? "n/a" : k.nps.toFixed(0)} sub={k.nps == null ? "No NPS responses yet" : `${k.npsN} responses · ${pts(k.nps, k.npsPrev, "") ?? "no previous data"}`} href={href("/cx/surveys")} info="% promoters (9–10) minus % detractors (0–6)." />
            <Metric label="Mentions" value={compact(k.mentions)} delta={k.mentionsDelta} href={href("/cx/listening")} sub={o.hasMentions ? undefined : "No mentions collected yet"} />
            <Metric label="Net sentiment" value={k.net == null ? "n/a" : `${k.net > 0 ? "+" : ""}${k.net.toFixed(0)}`} sub={pts(k.net, k.netPrev, "") ?? "Mentions, −100 to +100"} info="(positive − negative) / (positive + negative) mentions × 100." />
            <Metric label="Active crises" value={k.crises == null ? "n/a" : num(k.crises)} href={href("/cx/crisis")} sub={k.crises == null ? "Crisis module not set up" : undefined} />
          </MetricStrip>
        </CardBody>
      </Card>

      <Grid cols={2} className="mb-4">
        <Card>
          <CardHeader title="Ticket volume" description="Created vs solved per day" href={href("/cx/inbox")} />
          <CardBody>
            {o.hasTickets ? (
              <TrendChart data={o.trend} xKey="day" xFormat="day" type="line" series={[{ key: "created", label: "Created" }, { key: "solved", label: "Solved" }]} height={220} />
            ) : (
              <EmptyState icon={<Inbox className="h-5 w-5" />} title="No tickets yet" description="Connect email, live chat or a web form; conversations become tickets here." action={<ButtonLink href={href("/cx/settings/channels")} size="sm" variant="primary"><PlugZap className="h-3.5 w-3.5" /> Connect a channel</ButtonLink>} />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Mentions by sentiment" description="Per day, from listening sources" href={href("/cx/listening")} />
          <CardBody>
            {o.hasMentions ? (
              <TrendChart data={o.mentionTrend} xKey="day" xFormat="day" type="stacked" series={[{ key: "positive", label: "Positive", color: "var(--good)" }, { key: "neutral", label: "Neutral", color: "var(--text-3)" }, { key: "negative", label: "Negative", color: "var(--critical)" }]} height={220} />
            ) : (
              <EmptyState icon={<Ear className="h-5 w-5" />} title="No mentions yet" description="Add a topic with keywords; free sources (Google News, Hacker News, Mastodon, app reviews) start collecting mentions." action={<ButtonLink href={href("/cx/listening/topics")} size="sm" variant="primary">Add a topic</ButtonLink>} />
            )}
          </CardBody>
        </Card>
      </Grid>

      <Grid cols={3} className="mb-4">
        <Card>
          <CardHeader title="Channel mix" description={`Tickets created in ${days} days`} />
          <CardBody>
            {o.channelMix.length ? <DonutChart data={o.channelMix} centerValue={compact(k.created)} centerLabel="tickets" /> : <p className="py-8 text-center text-[13px] text-text-3">No tickets in this period.</p>}
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Agent leaderboard" description={`Tickets created in ${days} days, by assignee`} href={href("/cx/quality")} />
          <CardBody>
            <MiniTable
              columns={[{ header: "Agent" }, { header: "Assigned", align: "right" }, { header: "Solved", align: "right" }, { header: "Avg FRT", align: "right" }, { header: "Avg resolution", align: "right" }, { header: "SLA", align: "right" }, { header: "CSAT", align: "right" }, { header: "QA", align: "right" }]}
              rows={o.leaderboard.map((a) => [
                <span key="n" className="font-medium text-text">{a.name}</span>,
                num(a.assigned),
                num(a.solved),
                dur(a.frt),
                dur(a.art),
                a.sla == null ? "n/a" : `${a.sla.toFixed(0)}%`,
                a.csat == null ? "n/a" : `${a.csat.toFixed(0)}%`,
                a.qa == null ? "n/a" : `${a.qa.toFixed(0)}%`,
              ])}
              empty="No assigned tickets in this period."
            />
          </CardBody>
        </Card>
      </Grid>

      <Card>
        <CardHeader title="Quick links" />
        <CardBody className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
          {quick.map((q) => (
            <Link key={q.label} href={q.href} className="group flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px] font-medium text-text hover:bg-surface-2">
              <q.icon className="h-4 w-4 text-text-3" />
              <span className="truncate">{q.label}</span>
              <ArrowRight className="ml-auto h-3.5 w-3.5 text-text-3 opacity-0 group-hover:opacity-100" />
            </Link>
          ))}
        </CardBody>
      </Card>
    </Page>
  );
}
