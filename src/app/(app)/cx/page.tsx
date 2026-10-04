import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Clock, Ear, FileBarChart, Inbox, LayoutGrid, Send, Settings, Siren, UserX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { getOverview } from "@/lib/cx/insights/overview";
import { humanDuration } from "@/lib/cx/insights/metrics";
import { getHome } from "@/lib/cx/ui/home";
import type { AttentionItem, Kpi } from "@/lib/cx/ui/home-logic";
import { getUiPrefs } from "@/lib/cx/ui/prefs";
import { panelState, type PanelState } from "@/lib/cx/ui/prefs-logic";
import { compact, num } from "@/lib/format";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { Hideable, ShowHidden } from "@/components/shell/hideable";
import { DonutChart } from "@/components/charts/donut-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { BrandMeta, NoBrand, cxHref } from "@/components/cx/insights/common";

export const metadata: Metadata = { title: "CX Overview" };

const SCOPE = "cx-overview";
/** Optional sections and their default state: the landing stays calm until the user opens more. */
const PANELS = {
  setup: { id: `${SCOPE}.setup`, label: "Setup checklist", fallback: "open" },
  performance: { id: `${SCOPE}.performance`, label: "Service & feedback (30 days)", fallback: "collapsed" },
  trends: { id: `${SCOPE}.trends`, label: "Ticket and mention trends", fallback: "collapsed" },
  team: { id: `${SCOPE}.team`, label: "Channel mix and agents", fallback: "collapsed" },
} satisfies Record<string, { id: string; label: string; fallback: PanelState }>;

const dur = humanDuration;
const pts = (cur: number | null, prev: number | null, unit = " pts") => (cur == null || prev == null ? null : `${cur - prev >= 0 ? "+" : ""}${(cur - prev).toFixed(1)}${unit} vs prev.`);

const ATTENTION: Record<AttentionItem["kind"], { icon: typeof Clock; label: string; tone: "critical" | "warning" | "neutral" }> = {
  sla_breached: { icon: AlertTriangle, label: "SLA breached", tone: "critical" },
  sla_risk: { icon: Clock, label: "SLA at risk", tone: "warning" },
  crisis: { icon: Siren, label: "Crisis", tone: "critical" },
  unassigned: { icon: UserX, label: "Unassigned", tone: "neutral" },
};

export default async function CxOverviewPage({ searchParams }: PageProps<"/cx">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="CX Overview" />;
  const href = (p: string, extra: Record<string, string> = {}) => cxHref(p, brand.id, extra);
  const [home, prefs] = await Promise.all([getHome(brand.id), getUiPrefs(user.id)]);
  const open = (p: (typeof PANELS)[keyof typeof PANELS]) => panelState(prefs.panels, p.id, p.fallback) === "open";
  // The heavier 30-day analytics only load when one of their sections is open.
  const o = open(PANELS.performance) || open(PANELS.trends) || open(PANELS.team) ? await getOverview(brand.id, 30) : null;
  const k = home.kpis;

  const kpi = (label: string, v: Kpi, link: string, info: string) => (
    <Metric
      label={label}
      value={v.value == null ? "n/a" : num(v.value)}
      href={v.value == null ? undefined : link}
      info={info}
      sub={
        v.setup ? (
          <Link href={href(v.setup.href.split("?")[0], Object.fromEntries(new URLSearchParams(v.setup.href.split("?")[1] ?? "")))} className="text-link hover:underline">
            {v.sub} · {v.setup.label}
          </Link>
        ) : (
          v.sub
        )
      }
    />
  );

  const setup = [
    { done: home.setup.channels > 0, label: "Connect a channel", hint: "Email, live chat, web form or social accounts", href: href("/cx/settings/channels") },
    { done: home.setup.topics > 0, label: "Add a listening topic", hint: "Track mentions of your brand and competitors", href: href("/cx/listening/topics") },
    { done: home.setup.members > 0, label: "Invite your team", hint: "Agents, supervisors and viewers", href: href("/cx/settings/team") },
    { done: home.setup.policies > 0, label: "Set SLA targets", hint: "First response and resolution per priority", href: href("/cx/settings/team", { tab: "sla" }) },
    { done: home.setup.surveys > 0, label: "Create a survey", hint: "CSAT or NPS after conversations", href: href("/cx/surveys") },
  ];
  const doneCount = setup.filter((s) => s.done).length;

  const quick = [
    { label: "Tickets", icon: Inbox, href: href("/cx/inbox") },
    { label: "Mentions", icon: Ear, href: href("/cx/listening") },
    { label: "Publishing", icon: Send, href: href("/cx/publishing") },
    { label: "Dashboards", icon: LayoutGrid, href: href("/cx/dashboards") },
    { label: "Reports", icon: FileBarChart, href: href("/cx/reports") },
    { label: "Settings", icon: Settings, href: href("/cx/settings") },
  ];

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX" }, { label: "Overview" }]}
        title="Overview"
        subject={brand.name}
        meta={<BrandMeta switcher={switcher} current={brand.id} />}
        actions={<ShowHidden scope={SCOPE} refresh />}
      />

      <Card className="mb-4">
        <CardBody className="py-3">
          {/* 2×2 on phones, one row from sm up. */}
          <MetricStrip className="grid-cols-2 divide-y-0 sm:grid-cols-none">
            {kpi("Open tickets", k.open, href("/cx/inbox", { view: "open" }), "Tickets that are new, open, pending or on hold.")}
            {kpi("Unassigned", k.unassigned, href("/cx/inbox", { view: "unassigned" }), "Open tickets without an assignee; queue count from Queue & assignment.")}
            {kpi("SLA at risk", k.sla, href("/cx/inbox", { view: "breached" }), "Open tickets whose first-response or resolution deadline is within 60 minutes or already passed.")}
            {kpi("Negative mentions today", k.negative, href("/cx/listening", { sentiment: "negative" }), "Mentions published today (UTC) with negative sentiment.")}
          </MetricStrip>
        </CardBody>
      </Card>

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2 xl:group-data-[focus=on]/shell:col-span-3">
          <CardHeader
            title="Needs attention"
            description="Breached and at-risk SLAs, open crises and the oldest unassigned tickets."
            actions={
              home.attention.length > 0 && (
                <Link href={href("/cx/inbox", { view: home.counts.breached ? "breached" : "unassigned" })} className="text-[12.5px] text-link hover:underline">
                  Open inbox
                </Link>
              )
            }
          />
          <CardBody className="pt-0">
            {home.attention.length === 0 ? (
              <div className="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-good-ink" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-text">All clear</div>
                  <div className="text-[12.5px] text-text-3">{home.setup.tickets || home.setup.topics ? "No breached SLAs, open crises or unassigned tickets right now." : "Connect a channel and add a listening topic; urgent items will show up here."}</div>
                </div>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {home.attention.map((a) => {
                  const meta = ATTENTION[a.kind];
                  const Icon = meta.icon;
                  const link = a.ticketId ? href("/cx/inbox", { ticket: a.ticketId }) : href("/cx/crisis", a.crisisId ? { event: a.crisisId } : {});
                  return (
                    <li key={a.key}>
                      <Link href={link} className="group flex items-center gap-3 py-2.5 hover:bg-surface-2 sm:-mx-2 sm:rounded-md sm:px-2">
                        <Icon className={meta.tone === "critical" ? "h-4 w-4 shrink-0 text-critical-ink" : meta.tone === "warning" ? "h-4 w-4 shrink-0 text-warning-ink" : "h-4 w-4 shrink-0 text-text-3"} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-text">{a.title}</span>
                          <span className="block truncate text-[12px] text-text-3">{a.detail}</span>
                        </span>
                        <Badge tone={meta.tone} className="hidden shrink-0 sm:inline-flex">{meta.label}</Badge>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-text-3 opacity-0 group-hover:opacity-100" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
        <div className="self-start" data-focus-hide>
          <Card>
            <CardHeader title="Quick links" />
            <CardBody className="grid grid-cols-2 gap-2 pt-0">
              {quick.map((q) => (
                <Link key={q.label} href={q.href} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px] font-medium text-text hover:bg-surface-2">
                  <q.icon className="h-4 w-4 shrink-0 text-text-3" />
                  <span className="truncate">{q.label}</span>
                </Link>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="space-y-4">
        {doneCount < setup.length && (
          <Hideable id={PANELS.setup.id} label={PANELS.setup.label}>
            <Card>
              <CardHeader title="Set up your CX workspace" description={`${doneCount} of ${setup.length} steps done.`} />
              <CardBody className="grid gap-2 pt-0 sm:grid-cols-2 xl:grid-cols-3">
                {setup.map((s) => (
                  <Link key={s.label} href={s.href} className="flex items-start gap-2.5 rounded-md border border-border px-3 py-2.5 hover:bg-surface-2">
                    {s.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good-ink" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-text-3" />}
                    <span className="min-w-0">
                      <span className={`block text-[13px] font-medium ${s.done ? "text-text-2 line-through" : "text-text"}`}>{s.label}</span>
                      <span className="block text-[12px] text-text-3">{s.hint}</span>
                    </span>
                  </Link>
                ))}
              </CardBody>
            </Card>
          </Hideable>
        )}

        <div data-focus-hide>
          <Hideable id={PANELS.performance.id} label={PANELS.performance.label} defaultState="collapsed" refreshOnExpand>
            {o && (
              <Card>
                <CardHeader title="Service & feedback" description="Last 30 days vs the previous 30" />
                <CardBody className="pt-0">
                  <MetricStrip>
                    <Metric label="Avg first response" value={dur(o.kpis.frt)} delta={o.kpis.frtDelta} upIsGood={false} />
                    <Metric label="Avg resolution" value={dur(o.kpis.art)} delta={o.kpis.artDelta} upIsGood={false} />
                    <Metric label="SLA compliance" value={o.kpis.sla == null ? "n/a" : `${o.kpis.sla.toFixed(0)}%`} sub={pts(o.kpis.sla, o.kpis.slaPrev) ?? (o.kpis.sla == null ? "No decided SLA targets" : undefined)} />
                    <Metric label="CSAT" value={o.kpis.csat == null ? "n/a" : `${o.kpis.csat.toFixed(0)}%`} sub={o.kpis.csat == null ? "No ratings yet" : `${o.kpis.csatN} ratings`} href={href("/cx/surveys")} />
                    <Metric label="NPS" value={o.kpis.nps == null ? "n/a" : o.kpis.nps.toFixed(0)} sub={o.kpis.nps == null ? "No NPS responses yet" : `${o.kpis.npsN} responses`} href={href("/cx/surveys")} />
                    <Metric label="Net sentiment" value={o.kpis.net == null ? "n/a" : `${o.kpis.net > 0 ? "+" : ""}${o.kpis.net.toFixed(0)}`} sub={pts(o.kpis.net, o.kpis.netPrev, "") ?? "Mentions, −100 to +100"} />
                  </MetricStrip>
                </CardBody>
              </Card>
            )}
          </Hideable>
        </div>

        <Hideable id={PANELS.trends.id} label={PANELS.trends.label} defaultState="collapsed" refreshOnExpand>
          {o && (
            <Grid cols={2}>
              <Card>
                <CardHeader title="Ticket volume" description="Created vs solved per day" href={href("/cx/inbox")} />
                <CardBody>
                  {o.hasTickets ? (
                    <TrendChart data={o.trend} xKey="day" xFormat="day" type="line" series={[{ key: "created", label: "Created" }, { key: "solved", label: "Solved" }]} height={200} />
                  ) : (
                    <p className="py-8 text-center text-[13px] text-text-3">No tickets yet.</p>
                  )}
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Mentions by sentiment" description="Per day, from listening sources" href={href("/cx/listening")} />
                <CardBody>
                  {o.hasMentions ? (
                    <TrendChart data={o.mentionTrend} xKey="day" xFormat="day" type="stacked" series={[{ key: "positive", label: "Positive", color: "var(--good)" }, { key: "neutral", label: "Neutral", color: "var(--text-3)" }, { key: "negative", label: "Negative", color: "var(--critical)" }]} height={200} />
                  ) : (
                    <p className="py-8 text-center text-[13px] text-text-3">No mentions collected yet.</p>
                  )}
                </CardBody>
              </Card>
            </Grid>
          )}
        </Hideable>

        <Hideable id={PANELS.team.id} label={PANELS.team.label} defaultState="collapsed" refreshOnExpand>
          {o && (
            <Grid cols={3}>
              <Card>
                <CardHeader title="Channel mix" description="Tickets created in 30 days" />
                <CardBody>
                  {o.channelMix.length ? <DonutChart data={o.channelMix} centerValue={compact(o.kpis.created)} centerLabel="tickets" /> : <p className="py-8 text-center text-[13px] text-text-3">No tickets in this period.</p>}
                </CardBody>
              </Card>
              <Card className="xl:col-span-2">
                <CardHeader title="Agent leaderboard" description="Tickets created in 30 days, by assignee" href={href("/cx/quality")} />
                <CardBody>
                  <MiniTable
                    columns={[{ header: "Agent" }, { header: "Assigned", align: "right" }, { header: "Solved", align: "right" }, { header: "Avg FRT", align: "right" }, { header: "SLA", align: "right" }, { header: "CSAT", align: "right" }]}
                    rows={o.leaderboard.map((a) => [
                      <span key="n" className="font-medium text-text">{a.name}</span>,
                      num(a.assigned),
                      num(a.solved),
                      dur(a.frt),
                      a.sla == null ? "n/a" : `${a.sla.toFixed(0)}%`,
                      a.csat == null ? "n/a" : `${a.csat.toFixed(0)}%`,
                    ])}
                    empty="No assigned tickets in this period."
                  />
                </CardBody>
              </Card>
            </Grid>
          )}
        </Hideable>
      </div>
    </Page>
  );
}
