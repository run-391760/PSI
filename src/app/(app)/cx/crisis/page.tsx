import { ArrowLeft, ShieldCheck, Siren } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { TrendChart } from "@/components/charts/trend-chart";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { CrisisSettingsForm } from "@/components/cx/listening/crisis-settings";
import { Checklists, EventTools, ExtraSettingsForm } from "@/components/cx/listening/crisis-v2";
import { EventControls } from "@/components/cx/listening/event-controls";
import { JobButton } from "@/components/cx/listening/job-button";
import { ListeningNav } from "@/components/cx/listening/listening-nav";
import { MentionsFeed } from "@/components/cx/listening/mentions-feed";
import { NoBrand } from "@/components/cx/listening/no-brand";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge, type Tone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { aiConfigured } from "@/lib/cx/ai";
import { eventTimeline, getEvent, listEvents, type CrisisEvent, type ScopeResult } from "@/lib/cx/listening/crisis";
import { eventChecklists, eventRecovery, getExtraSettings, listPlaybooks } from "@/lib/cx/listening/crisis2";
import type { Risk } from "@/lib/cx/listening/crisis-math";
import { getSettings, listTopics } from "@/lib/cx/listening/data";
import { dateTimeLabel, num, pct, timeAgo } from "@/lib/format";
import { latestJob } from "@/lib/jobs/queue";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Crisis management" };

const STATUS_TONE: Record<string, Tone> = { open: "critical", monitoring: "warning", resolved: "good" };
const SEV_TONE: Record<string, Tone> = { critical: "critical", warning: "warning" };
const KIND_LABEL: Record<string, string> = { volume: "Volume spike", negative: "Negative spike", both: "Volume + negative" };
const z = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "n/a");
const RISK_TONE: Record<string, Tone> = { high: "critical", elevated: "warning", low: "good" };
function RiskBadge({ risk }: { risk?: Partial<Risk> | null }) {
  if (!risk || risk.score == null) return <span className="text-[12px] text-text-3">n/a</span>;
  return (
    <Badge tone={RISK_TONE[risk.band ?? "low"]}>
      <span title={`velocity ${(risk.velocity ?? 0).toFixed(2)} × negativity ${(risk.negativity ?? 0).toFixed(2)} × reach ${(risk.reach ?? 0).toFixed(2)}${risk.reachKnown ? "" : " (reach from mention count)"}`}>Risk {risk.score}</span>
    </Badge>
  );
}

export default async function CrisisPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Crisis management" />;
  const eventId = typeof sp.event === "string" ? sp.event : null;
  const statusFilter = typeof sp.status === "string" && ["open", "monitoring", "resolved"].includes(sp.status) ? sp.status : undefined;
  const [settings, events, topics, job, extra] = await Promise.all([getSettings(brand.id), listEvents(brand.id), listTopics(brand.id), latestJob(brand.id, "cx.listening.detect"), getExtraSettings(brand.id)]);
  const running = job && ["queued", "running"].includes(job.status) ? job.id : null;
  const counts = { open: events.filter((e) => e.status === "open").length, monitoring: events.filter((e) => e.status === "monitoring").length, resolved: events.filter((e) => e.status === "resolved").length };
  const scopes = ((settings.lastDetect as { scopes?: ScopeResult[] }).scopes ?? []) as ScopeResult[];
  const header = (
    <>
      <PageHeader
        breadcrumbs={[{ label: "CX" }, { label: "Listening", href: `/cx/listening?brand=${brand.id}` }, { label: "Crisis management" }]}
        title="Crisis management"
        subject={brand.name}
        description="Automatic spike detection on mention volume and negative sentiment, with crisis events, escalation owners and a shared timeline."
        actions={
          <>
            <BrandSwitcher brands={switcher} current={brand.id} />
            {topics.length > 0 && <JobButton brandId={brand.id} kind="detect" initialJobId={running} variant="secondary" />}
          </>
        }
      />
      <ListeningNav current="/cx/crisis" brandId={brand.id} counts={{ "/cx/crisis": counts.open }} />
    </>
  );

  if (eventId) {
    const data = await getEvent(brand.id, eventId).catch(() => null);
    if (!data)
      return (
        <Page>
          {header}
          <Card>
            <EmptyState title="Crisis event not found" action={<ButtonLink href={`/cx/crisis?brand=${brand.id}`}>Back to events</ButtonLink>} />
          </Card>
        </Page>
      );
    const { event: e, notes, mentions } = data;
    const [buckets, recovery, checklists, playbooks] = await Promise.all([eventTimeline(brand, e), eventRecovery(brand.id, e, settings.baselineDays), eventChecklists(e.id), listPlaybooks(brand.id)]);
    const untickedNegative = mentions.filter((x) => x.sentiment === "negative" && !x.ticket_id && x.status !== "ignored").length;
    const hourly = settings.windowHours < 24;
    const chart = buckets.map((b) => ({
      label: new Date(b.start).toLocaleString("en-US", hourly ? { month: "short", day: "numeric", hour: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" }),
      mentions: b.total,
      negative: b.negative,
    }));
    const m = e.metrics;
    return (
      <Page>
        {header}
        <Link href={`/cx/crisis?brand=${brand.id}`} className="mb-3 inline-flex items-center gap-1 text-[13px] text-link">
          <ArrowLeft className="h-3.5 w-3.5" /> All events
        </Link>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="text-[18px] font-semibold text-text">{e.title}</h2>
          <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge>
          <Badge tone={SEV_TONE[e.severity]}>{e.severity}</Badge>
          <Badge>{KIND_LABEL[e.kind]}</Badge>
          <RiskBadge risk={e.risk as Risk} />
        </div>
        <MetricStrip className="mb-5">
          <Metric label="Mentions in spike window" value={num(m.volume?.value)} sub={`baseline ${m.volume ? m.volume.mean.toFixed(1) : "n/a"} per window`} />
          <Metric label="Volume z-score" value={z(m.volume?.z)} />
          <Metric label="Negative in window" value={num(m.negative?.value)} sub={`baseline ${m.negative ? m.negative.mean.toFixed(1) : "n/a"}`} />
          <Metric label="Negative z-score" value={z(m.negative?.z)} />
          <Metric label="Peak z" value={z(e.peak_z)} sub={`detected ${timeAgo(e.detected_at)}`} />
        </MetricStrip>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
          <div className="grid min-w-0 grid-cols-1 content-start gap-5">
            <Card>
              <CardHeader title="Timeline" description={`Mentions per ${settings.windowHours}h window for ${e.topic_name ?? "all topics"} (UTC); spike started ${dateTimeLabel(e.window_start)}`} />
              <CardBody>
                <TrendChart
                  data={chart}
                  xKey="label"
                  xFormat="raw"
                  height={240}
                  showLegend
                  series={[
                    { key: "mentions", label: "Mentions" },
                    { key: "negative", label: "Negative", color: "var(--critical)" },
                  ]}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                title="Recovery vs pre-crisis baseline"
                description={recovery.baseline.volume == null ? "No baseline: no stored mentions before the spike for this scope." : `Daily volume index (baseline ${recovery.baseline.volume.toFixed(1)}/day over ${recovery.baseline.days}d = 100) and negative share; baseline negative share ${recovery.baseline.negativeShare == null ? "n/a" : pct(recovery.baseline.negativeShare)}`}
                info="Recovered = 7-day average volume ≤ 125% of baseline and negative share ≤ baseline + 5 points."
              />
              <CardBody className="grid gap-4">
                <div className="grid grid-cols-3 gap-2">
                  {recovery.milestones.map((m) => (
                    <div key={m.day} className="rounded-md border border-border p-2.5">
                      <div className="text-[12px] text-text-3">Day {m.day}</div>
                      <div className="mt-0.5 text-[14px] font-semibold">
                        {!m.reached ? <span className="text-text-3">Not yet</span> : m.recovered == null ? "n/a" : m.recovered ? <span className="text-good-ink">Recovered</span> : <span className="text-critical-ink">Not recovered</span>}
                      </div>
                      <div className="text-[11.5px] text-text-3">{m.reached ? `volume ${m.volumeIndex == null ? "n/a" : Math.round(m.volumeIndex)} · neg ${m.negativeShare == null ? "n/a" : pct(m.negativeShare)}` : dateTimeLabel(m.date).split(",")[0]}</div>
                    </div>
                  ))}
                </div>
                {recovery.baseline.volume != null && recovery.points.length > 1 && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <TrendChart data={recovery.points} xKey="date" xFormat="day" height={180} yFormat="number" showLegend series={[{ key: "volumeIndex", label: "Volume index" }, { key: "baselineIndex", label: "Baseline", dashed: true, color: "var(--chart-text)" }]} />
                    <TrendChart data={recovery.points} xKey="date" xFormat="day" height={180} yFormat="percent" showLegend series={[{ key: "negativeShare", label: "Negative share", color: "var(--critical)" }, { key: "baselineNegative", label: "Baseline", dashed: true, color: "var(--chart-text)" }]} />
                  </div>
                )}
              </CardBody>
            </Card>
            <div>
              <div className="mb-2 text-[13px] font-semibold text-text">
                Linked mentions <span className="font-normal text-text-3">({num(e.mentions)}, {num(e.negative)} negative{e.mentions > 50 ? "; latest 50 shown" : ""})</span>
              </div>
              {mentions.length ? (
                <MentionsFeed
                  brandId={brand.id}
                  mentions={mentions.slice(0, 50).map((x) => ({
                    id: x.id, topic_name: x.topic_name, topic_kind: x.topic_kind, source: x.source, url: x.url, author: x.author, author_handle: x.author_handle,
                    author_followers: x.author_followers, title: x.title, body: x.body.slice(0, 800), language: x.language, translation: x.translation?.slice(0, 800) ?? null, published_at: x.published_at, sentiment: x.sentiment,
                    intent: x.intent, engagement: x.engagement, status: x.status, tags: x.tags, ticket_id: x.ticket_id, ticket_number: x.ticket_number,
                  }))}
                />
              ) : (
                <Card>
                  <EmptyState title="No linked mentions" description="Mentions in the spike window are linked when the event is detected." />
                </Card>
              )}
            </div>
          </div>
          <div className="grid content-start gap-5">
            <Card>
              <CardHeader title="Escalation" />
              <CardBody>
                <EventControls brandId={brand.id} id={e.id} status={e.status} severity={e.severity} owner={e.owner} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Response" description="Tickets, statements and the debrief" />
              <CardBody>
                <EventTools brandId={brand.id} eventId={e.id} untickedNegative={untickedNegative} aiReady={aiConfigured()} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Playbook" href={`/cx/crisis/playbooks?brand=${brand.id}`} />
              <Checklists brandId={brand.id} eventId={e.id} checklists={checklists} playbooks={playbooks.map((p) => ({ id: p.id, name: p.name }))} />
            </Card>
            <Card>
              <CardHeader title="Activity" description="Notes, status changes and system events" />
              <ol className="grid gap-0 px-4 pb-4">
                {notes.map((n) => (
                  <li key={n.id} className="relative border-l border-border pb-3 pl-4 last:pb-0">
                    <span className={cn("absolute top-1 -left-[5px] h-2.5 w-2.5 rounded-full border-2 border-surface", n.kind === "note" ? "bg-brand" : n.kind === "system" ? "bg-warning" : "bg-text-3")} />
                    <div className="text-[12px] text-text-3">
                      <span className="font-medium text-text-2">{n.author_name || "Someone"}</span> · {dateTimeLabel(n.created_at)}
                    </div>
                    <div className="mt-0.5 text-[13px] whitespace-pre-wrap text-text">{n.body}</div>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        </div>
      </Page>
    );
  }

  const shown = statusFilter ? events.filter((e) => e.status === statusFilter) : events;
  return (
    <Page>
      {header}
      {topics.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Siren className="h-5 w-5" />}
            title="Add topics to enable crisis detection"
            description="Spike detection runs after every hourly fetch and compares each window with a trailing baseline."
            action={<ButtonLink href={`/cx/listening/topics?brand=${brand.id}`} variant="primary">Add a topic</ButtonLink>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          <MetricStrip>
            <Metric label="Open events" value={num(counts.open)} />
            <Metric label="Monitoring" value={num(counts.monitoring)} />
            <Metric label="Resolved" value={num(counts.resolved)} />
            <Metric label="Last detection" value={settings.lastDetectAt ? timeAgo(settings.lastDetectAt) : "n/a"} sub={`${settings.windowHours}h window · ${settings.baselineDays}d baseline`} />
          </MetricStrip>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_380px]">
            <div className="grid min-w-0 grid-cols-1 content-start gap-5">
              <Card>
                <CardHeader title="Current signal" description={`Last ${settings.windowHours}h vs the trailing ${settings.baselineDays}-day baseline, per topic`} />
                <MiniTable
                  className="px-4 pb-3"
                  empty="Detection has not run yet. It runs after each fetch, or use Run detection."
                  columns={[{ header: "Scope" }, { header: "Mentions", align: "right" }, { header: "Baseline", align: "right" }, { header: "Volume z", align: "right" }, { header: "Negative", align: "right" }, { header: "Negative z", align: "right" }, { header: "Risk" }, { header: "State" }]}
                  rows={scopes.map((s) => [
                    <span key="n" className="font-medium">{s.name}</span>,
                    num(s.result.volume.value),
                    s.result.ready ? s.result.volume.mean.toFixed(1) : "n/a",
                    s.result.ready ? z(s.result.volume.z) : "n/a",
                    num(s.result.negative.value),
                    s.result.ready ? z(s.result.negative.z) : "n/a",
                    <RiskBadge key="r" risk={s.risk} />,
                    s.result.triggered ? (
                      <Badge key="b" tone={SEV_TONE[s.result.severity ?? "warning"]}>Spike</Badge>
                    ) : s.result.ready ? (
                      <Badge key="b" tone="good">Normal</Badge>
                    ) : (
                      <span key="b" className="text-[12px] text-text-3" title={s.result.reason}>Learning baseline</span>
                    ),
                  ])}
                />
              </Card>
              <Card>
                <CardHeader title="Crisis events" />
                <nav className="flex gap-1 border-b border-border px-3" aria-label="Event status">
                  {[{ k: undefined, l: `All (${events.length})` }, { k: "open", l: `Open (${counts.open})` }, { k: "monitoring", l: `Monitoring (${counts.monitoring})` }, { k: "resolved", l: `Resolved (${counts.resolved})` }].map((t) => (
                    <Link
                      key={t.l}
                      href={`/cx/crisis?brand=${brand.id}${t.k ? `&status=${t.k}` : ""}`}
                      className={cn("-mb-px border-b-2 px-2.5 py-2 text-[12.5px] font-medium whitespace-nowrap", statusFilter === t.k ? "border-brand text-text" : "border-transparent text-text-2 hover:text-text")}
                    >
                      {t.l}
                    </Link>
                  ))}
                </nav>
                {shown.length ? (
                  <ul className="divide-y divide-border">
                    {shown.map((e) => (
                      <EventRow key={e.id} e={e} brandId={brand.id} />
                    ))}
                  </ul>
                ) : (
                  <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No crisis events" description="When mention volume or negative sentiment spikes above your thresholds, an event opens here and an alert is sent." />
                )}
              </Card>
            </div>
            <div className="grid content-start gap-5">
              <Card>
                <CardHeader title="Detection thresholds" description="z-score = (window count − baseline mean) / baseline SD (floored at √mean)." />
                <CrisisSettingsForm
                  brandId={brand.id}
                  initial={{ volumeZ: settings.volumeZ, negativeZ: settings.negativeZ, minMentions: settings.minMentions, baselineDays: settings.baselineDays, windowHours: settings.windowHours, escalationOwner: settings.escalationOwner, notify: settings.notify }}
                />
              </Card>
              <Card>
                <CardHeader title="Automation" description="Risk score = ∛(velocity × negativity × reach) × 100" info="Velocity from the volume z-score, negativity from the negative share, reach from author followers (or mention count when the source reports no followers)." />
                <ExtraSettingsForm brandId={brand.id} initial={extra} />
              </Card>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

function EventRow({ e, brandId }: { e: CrisisEvent; brandId: string }) {
  return (
    <li>
      <Link href={`/cx/crisis?brand=${brandId}&event=${e.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-2">
        <Siren className={cn("h-4 w-4 shrink-0", e.severity === "critical" ? "text-critical-ink" : "text-warning-ink")} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-text">{e.title}</div>
          <div className="text-[12px] text-text-3">
            {dateTimeLabel(e.detected_at)} · {num(e.mentions)} mentions, {num(e.negative)} negative · peak z {z(e.peak_z)}
            {e.owner ? ` · owner ${e.owner}` : ""}
          </div>
        </div>
        <RiskBadge risk={e.risk as Risk} />
        <Badge tone={SEV_TONE[e.severity]}>{e.severity}</Badge>
        <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge>
      </Link>
    </li>
  );
}
