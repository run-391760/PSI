import { ShieldCheck, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { aiConfigured } from "@/lib/cx/ai";
import { cxContext } from "@/lib/cx/context";
import { listShareLinks } from "@/lib/cx/insights/dashboards";
import { askHistory, getAiSettings, listBriefs, metricsSnapshot } from "@/lib/cx/insights/intelligence";
import { brandMailer } from "@/lib/cx/insights/mailer";
import { brandSignals } from "@/lib/cx/insights/signals";
import { dateTimeLabel, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";
import { TabsNav } from "@/components/ui/tabs";
import { BrandMeta, NoBrand, cxHref, ticketHref } from "@/components/cx/insights/common";
import { AiSignalButton, AskBox, BriefSettings, ConnectorTokens } from "@/components/cx/insights/ask-client";

export const metadata: Metadata = { title: "Ask AI" };
const LEVEL: Record<string, Tone> = { high: "critical", medium: "warning", low: "good" };

function NoAi({ what }: { what: string }) {
  return (
    <Callout className="mb-4" title="Connect an AI key">
      {what} needs an AI key (Anthropic, OpenAI or Gemini) on the server. The aggregated metrics below are real and are exactly what the model would see.
    </Callout>
  );
}

export default async function AskPage({ searchParams }: PageProps<"/cx/ask">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Ask AI" />;
  const tab = typeof sp.tab === "string" ? sp.tab : "ask";
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const ai = aiConfigured();
  const h = (t: string, extra: Record<string, string | number> = {}) => cxHref("/cx/ask", brand.id, { tab: t, ...extra });

  let body: React.ReactNode;
  if (tab === "signals") {
    const rows = await brandSignals(brand.id, 30);
    const high = rows.filter((r) => r.churn.level === "high").length;
    const esc = rows.filter((r) => r.escalation.level === "high").length;
    const predicted = rows.filter((r) => !r.csat.known);
    const avgPred = predicted.length ? predicted.reduce((s, r) => s + r.csat.value, 0) / predicted.length : null;
    body = (
      <>
        <Card className="mb-4">
          <CardBody className="py-4">
            <MetricStrip>
              <Metric label="Tickets scored" value={num(rows.length)} sub="Open + solved in 30 days" />
              <Metric label="High churn risk" value={num(high)} />
              <Metric label="Likely to escalate" value={num(esc)} />
              <Metric label="Predicted CSAT (unrated)" value={avgPred == null ? "n/a" : avgPred.toFixed(1)} sub={`${predicted.length} tickets without a rating`} />
            </MetricStrip>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Ticket signals" description="Heuristic scores from sentiment, intent, reopens, SLA breaches, waiting time and repeat contacts. Ranked by churn risk." />
          <CardBody className="pt-1">
            {rows.length === 0 ? (
              <EmptyState title="No tickets to score" description="Signals appear for open tickets and tickets solved in the last 30 days." />
            ) : (
              <MiniTable
                columns={[{ header: "Ticket" }, { header: "Contact" }, { header: "CSAT (pred.)", align: "right" }, { header: "Churn risk" }, { header: "Escalation" }, { header: "Why" }, ...(ai ? [{ header: "" }] : [])]}
                rows={rows.slice(0, 100).map((r) => [
                  <Link key="t" href={ticketHref(brand.id, r.id)} className="text-link hover:underline">#{r.number} <span className="text-text-2">{(r.subject || "(no subject)").slice(0, 50)}</span></Link>,
                  r.contact ?? "n/a",
                  <span key="c" className="tabular-nums">{r.csat.value.toFixed(1)}{r.csat.known ? " ✓" : ""}</span>,
                  <Badge key="ch" tone={LEVEL[r.churn.level]}>{r.churn.level} · {r.churn.score}</Badge>,
                  <Badge key="es" tone={LEVEL[r.escalation.level]}>{r.escalation.level} · {r.escalation.score}</Badge>,
                  <span key="w" className="text-[12px] text-text-2">{[...new Set([...r.churn.reasons, ...r.escalation.reasons])].slice(0, 3).join(" · ") || "No risk factors"}</span>,
                  ...(ai ? [<AiSignalButton key="ai" brand={brand.id} ticketId={r.id} />] : []),
                ])}
              />
            )}
            <p className="mt-3 text-[12px] text-text-3">✓ = actual customer rating. Signals for one ticket are available to the inbox through <code>ticketSignals(projectId, ticketId)</code>.</p>
          </CardBody>
        </Card>
      </>
    );
  } else if (tab === "briefs") {
    const [settings, briefs, mailer] = await Promise.all([getAiSettings(brand.id), listBriefs(brand.id), brandMailer(brand.id)]);
    body = (
      <>
        {!ai && <NoAi what="Writing executive briefs" />}
        <Grid cols={2}>
          <Card>
            <CardHeader title="Executive brief schedule" description="A short leadership summary of volume, speed, SLA, satisfaction, quality and listening, with changes vs the previous period." />
            <CardBody className="pt-1">
              <BriefSettings brand={brand.id} cadence={settings.brief_cadence} recipients={settings.brief_recipients} ai={ai} mailbox={!!mailer} />
              {settings.brief_next_at && <p className="mt-3 text-[12px] text-text-3">Next brief: {dateTimeLabel(settings.brief_next_at)}{ai ? "" : " (skipped until an AI key is connected)"}</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={`Past briefs (${briefs.length})`} />
            <CardBody className="space-y-3 pt-1">
              {briefs.length === 0 && <p className="py-6 text-center text-[13px] text-text-3">No briefs yet.</p>}
              {briefs.map((b) => (
                <details key={b.id} className="rounded-md border border-border p-2.5" open={b === briefs[0]}>
                  <summary className="cursor-pointer text-[13px] font-medium text-text">
                    {b.period === "weekly" ? "Weekly" : "Monthly"} brief · {dateTimeLabel(b.created_at)}
                  </summary>
                  <p className="mt-2 text-[13px] whitespace-pre-line text-text-2">{b.body}</p>
                </details>
              ))}
            </CardBody>
          </Card>
        </Grid>
      </>
    );
  } else if (tab === "connector") {
    const tokens = await listShareLinks(brand.id, "mcp");
    body = (
      <Grid cols={2}>
        <Card>
          <CardHeader title="MCP connector" description="Let an AI assistant (Claude, ChatGPT or any MCP client) query this brand's aggregated metrics with the get_cx_metrics tool." />
          <CardBody className="pt-1">
            <ConnectorTokens brand={brand.id} tokens={JSON.parse(JSON.stringify(tokens))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="What the connector can see" />
          <CardBody className="space-y-2 pt-1 text-[13px] text-text-2">
            <p className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-good-ink" /> Aggregates only: counts, averages and rates by channel, intent, priority, tag and agent.</p>
            <p className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-good-ink" /> No message text, contact names, emails or phone numbers are ever returned.</p>
            <p className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-good-ink" /> Scoped to this brand; revoking a token cuts access immediately. Rate limited to 60 calls per minute.</p>
          </CardBody>
        </Card>
      </Grid>
    );
  } else {
    const [snap, history] = await Promise.all([metricsSnapshot(brand.id, days), askHistory(brand.id)]);
    const t = snap.tickets;
    body = (
      <>
        {!ai && <NoAi what="Answering questions in plain language" />}
        {ai && (
          <Card className="mb-4">
            <CardHeader title="Ask about your CX metrics" description={`Answers use only the aggregated metrics of the last ${days} days shown below.`} />
            <CardBody className="pt-1"><AskBox brand={brand.id} days={days} /></CardBody>
          </Card>
        )}
        <div className="mb-3 flex items-center gap-1.5 text-[12px] text-text-3">
          Period:
          {[7, 30, 90].map((x) => (
            <Link key={x} href={h("ask", { days: x })} className={cn("rounded px-2 py-0.5", x === days ? "bg-brand-soft font-medium text-text" : "hover:bg-surface-3")}>{x}d</Link>
          ))}
        </div>
        <Card className="mb-4">
          <CardHeader title="What the model sees" description="Trust layer: the AI receives this aggregated snapshot, never raw conversations or customer details." actions={<Badge tone="good"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" />Aggregates only</Badge>} />
          <CardBody className="pt-1">
            <MetricStrip>
              <Metric label="Tickets created" value={num(t.created)} delta={t.createdChangePct} upIsGood={false} />
              <Metric label="Avg first response" value={t.avgFirstResponseHours == null ? "n/a" : `${t.avgFirstResponseHours} h`} />
              <Metric label="Avg resolution" value={t.avgResolutionHours == null ? "n/a" : `${t.avgResolutionHours} h`} />
              <Metric label="SLA compliance" value={t.slaCompliancePct == null ? "n/a" : `${t.slaCompliancePct}%`} />
              <Metric label="CSAT" value={snap.satisfaction.csatPct == null ? "n/a" : `${snap.satisfaction.csatPct}%`} sub={`${snap.satisfaction.csatResponses} responses`} />
              <Metric label="Mentions" value={num(snap.listening.mentions)} />
            </MetricStrip>
            <details className="mt-3">
              <summary className="cursor-pointer text-[12.5px] font-medium text-text-2">Full snapshot (JSON)</summary>
              <pre className="scroll-thin mt-2 max-h-80 overflow-auto rounded-md bg-surface-2 p-3 text-[11.5px] text-text">{JSON.stringify(snap, null, 2)}</pre>
            </details>
          </CardBody>
        </Card>
        {history.length > 0 && (
          <Card>
            <CardHeader title="Recent questions" />
            <CardBody className="divide-y divide-border pt-0">
              {history.map((x) => (
                <div key={x.id} className="py-2.5">
                  <div className="text-[13px] font-medium text-text">{x.question}</div>
                  <p className="mt-0.5 text-[13px] whitespace-pre-line text-text-2">{x.answer}</p>
                  <div className="mt-0.5 text-[11.5px] text-text-3">{x.asker ?? "Someone"} · {dateTimeLabel(x.created_at)}</div>
                </div>
              ))}
            </CardBody>
          </Card>
        )}
      </>
    );
  }

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX", href: cxHref("/cx", brand.id) }, { label: "Ask AI" }]}
        title="Ask AI"
        subject={brand.name}
        description="Plain-language answers, executive briefs and predictive signals from your CX data."
        meta={
          <BrandMeta switcher={switcher} current={brand.id}>
            <Badge tone={ai ? "good" : "neutral"}><Sparkles className="mr-1 inline h-3.5 w-3.5" />{ai ? "AI connected" : "AI not connected"}</Badge>
          </BrandMeta>
        }
      />
      <TabsNav
        className="mb-4"
        items={[
          { href: h("ask"), label: "Ask" },
          { href: h("briefs"), label: "Executive briefs" },
          { href: h("signals"), label: "Signals" },
          { href: h("connector"), label: "Connector (MCP)" },
        ]}
      />
      {body}
    </Page>
  );
}
