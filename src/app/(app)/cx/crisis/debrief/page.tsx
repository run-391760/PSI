import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { NoBrand } from "@/components/cx/listening/no-brand";
import { SourceIcon } from "@/components/cx/listening/source-icon";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { PrintButton } from "@/components/ui/print-button";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { debrief } from "@/lib/cx/listening/crisis2";
import type { Risk } from "@/lib/cx/listening/crisis-math";
import { INTENTS, sourceLabel } from "@/lib/cx/listening/sources";
import { compact, dateTimeLabel, num, pct } from "@/lib/format";

const span = (min: number) => (min < 60 ? `${Math.round(min)}m` : min < 2880 ? `${(min / 60).toFixed(1)}h` : `${(min / 1440).toFixed(1)}d`);

export const metadata: Metadata = { title: "Crisis debrief" };

export default async function DebriefPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Crisis debrief" />;
  const id = typeof sp.event === "string" ? sp.event : "";
  const d = id ? await debrief(brand, id).catch(() => null) : null;
  if (!d)
    return (
      <Page>
        <PageHeader breadcrumbs={[{ label: "CX" }, { label: "Crisis", href: `/cx/crisis?brand=${brand.id}` }, { label: "Debrief" }]} title="Crisis debrief" />
        <Card><EmptyState title="Crisis event not found" action={<ButtonLink href={`/cx/crisis?brand=${brand.id}`}>Back to events</ButtonLink>} /></Card>
      </Page>
    );
  const e = d.event;
  const risk = e.risk as Partial<Risk>;
  const resolvedTickets = d.tickets.filter((t) => ["solved", "closed"].includes(t.status)).length;
  const responded = d.tickets.filter((t) => t.first_response_at).length;
  const m = e.metrics;
  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX" }, { label: "Crisis", href: `/cx/crisis?brand=${brand.id}` }, { label: "Debrief" }]}
        title="Crisis debrief"
        subject={e.title}
        description={`Generated ${dateTimeLabel(new Date().toISOString())} from the event's stored mentions, notes, tickets and recovery data.`}
        meta={<><Badge tone={e.status === "resolved" ? "good" : "warning"}>{e.status}</Badge><Badge tone={e.severity === "critical" ? "critical" : "warning"}>{e.severity}</Badge></>}
        actions={<><BrandSwitcher brands={switcher} current={brand.id} /><PrintButton /></>}
      />
      <Link href={`/cx/crisis?brand=${brand.id}&event=${e.id}`} className="mb-3 inline-flex items-center gap-1 text-[13px] text-link print:hidden"><ArrowLeft className="h-3.5 w-3.5" /> Back to event</Link>
      <div className="grid grid-cols-1 gap-5">
        <MetricStrip>
          <Metric label="Linked mentions" value={num(e.mentions)} sub={`${num(e.negative)} negative`} />
          <Metric label="Peak z-score" value={Number.isFinite(e.peak_z) ? e.peak_z.toFixed(1) : "n/a"} />
          <Metric label="Risk score" value={risk?.score == null ? "n/a" : String(risk.score)} sub={risk?.band} />
          <Metric label="Duration" value={span(d.durationHours * 60)} sub={e.status === "resolved" ? "spike start → resolved" : "so far"} />
          <Metric label="First human response" value={d.responseMinutes == null ? "n/a" : span(d.responseMinutes)} sub="after detection" />
        </MetricStrip>

        <Card>
          <CardHeader title="1. What happened" />
          <CardBody className="grid gap-2 text-[13.5px] leading-relaxed">
            <p>
              On {dateTimeLabel(e.window_start)} {e.topic_name ? <>mentions of <b>{e.topic_name}</b></> : "brand mentions"} rose to {num(m.volume?.value)} in one window against a baseline of {m.volume ? m.volume.mean.toFixed(1) : "n/a"} (z {m.volume ? m.volume.z.toFixed(1) : "n/a"}), with {num(m.negative?.value)} negative mentions (baseline {m.negative ? m.negative.mean.toFixed(1) : "n/a"}).
              The event was detected {dateTimeLabel(e.detected_at)}{e.owner ? ` and owned by ${e.owner}` : ""}.
            </p>
            <p>Sources: {d.sources.map((s) => `${sourceLabel(s.key)} ${num(s.count)}`).join(", ") || "n/a"}.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="2. Why: conversation drivers" />
          <CardBody className="grid gap-4 md:grid-cols-3">
            <div><div className="mb-1 text-[12px] font-semibold text-text-2">Top terms</div><p className="text-[13px]">{d.terms.map((t) => `${t.term} (${t.count})`).join(", ") || "n/a"}</p></div>
            <div><div className="mb-1 text-[12px] font-semibold text-text-2">Top phrases</div><p className="text-[13px]">{d.phrases.map((t) => `${t.term} (${t.count})`).join(", ") || "n/a"}</p></div>
            <div><div className="mb-1 text-[12px] font-semibold text-text-2">Intents</div><p className="text-[13px]">{d.intents.map((t) => `${INTENTS[t.key] ?? t.key} (${t.count})`).join(", ") || "n/a"}</p></div>
          </CardBody>
          <MiniTable
            className="px-4 pb-3"
            columns={[{ header: "Most active authors" }, { header: "Mentions", align: "right" }, { header: "Followers", align: "right" }]}
            rows={d.authors.map((a) => [<span key="a" className="flex items-center gap-2"><SourceIcon source={a.source} />{a.author}</span>, num(a.n), a.followers == null ? "n/a" : compact(a.followers)])}
          />
        </Card>

        <Card>
          <CardHeader title="3. Response" description={`${num(d.tickets.length)} tickets from crisis mentions, ${num(responded)} answered, ${num(resolvedTickets)} resolved`} />
          <ol className="grid gap-2 px-4 pb-4">
            {d.notes.map((n) => (
              <li key={n.id} className="grid grid-cols-[150px_1fr] gap-3 text-[13px] max-sm:grid-cols-1 max-sm:gap-0">
                <span className="text-text-3">{dateTimeLabel(n.created_at)}</span>
                <span><span className="font-medium">{n.author_name || "Someone"}:</span> {n.body}</span>
              </li>
            ))}
          </ol>
        </Card>

        <Card>
          <CardHeader title="4. Impact and recovery" description={d.recovery.baseline.volume == null ? "No pre-crisis baseline stored for this scope." : `Baseline ${d.recovery.baseline.volume.toFixed(1)} mentions/day, ${d.recovery.baseline.negativeShare == null ? "n/a" : pct(d.recovery.baseline.negativeShare)} negative`} />
          <MiniTable
            className="px-4 pb-3"
            columns={[{ header: "Milestone" }, { header: "Volume index", align: "right" }, { header: "Negative share", align: "right" }, { header: "Status" }]}
            rows={d.recovery.milestones.map((x) => [
              `Day ${x.day}`,
              x.volumeIndex == null ? "n/a" : Math.round(x.volumeIndex),
              x.negativeShare == null ? "n/a" : pct(x.negativeShare),
              !x.reached ? "Not reached yet" : x.recovered == null ? "n/a" : x.recovered ? "Recovered" : "Not recovered",
            ])}
          />
        </Card>
      </div>
    </Page>
  );
}
