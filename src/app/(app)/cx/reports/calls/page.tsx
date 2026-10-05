import type { Metadata } from "next";
import { Check, PhoneCall, PlugZap } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { reportContext } from "@/lib/cx/reports/data";
import { callsView, engagementBase } from "@/lib/cx/reports/engagement";
import { CALL_TABS, callTab } from "@/lib/cx/reports/engagement-model";
import { dmy, rangeLabel, type DrillSpec } from "@/lib/cx/reports/model";
import { NoBrand } from "@/components/cx/insights/common";
import { ReportFrame } from "@/components/cx/reports/frame";
import { DrillTableK, IntervalSelect, LineChartK, TileRow, Widget, type KCell } from "@/components/cx/reports/kit";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { TabsNav } from "@/components/ui/tabs";

export const metadata: Metadata = { title: "Calls Analytics" };
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Shown while the channel catalogue has no telephony entry (no provider, env vars or webhook exist yet). */
const FALLBACK = {
  name: "Telephony",
  api: "A cloud telephony or contact-centre provider (call detail records + agent status events)",
  cost: "paid" as const,
  costNote: "Paid: per-minute call charges and per-agent seats at the telephony provider",
  env: [] as string[],
  setup: "Telephony isn't in this workspace's channel catalogue yet. Once a provider is added, connect it in Settings → Channels; calls then arrive as phone tickets and these reports fill in.",
};
const COST = { free: "Free", "free-approval": "Free (approval needed)", paid: "Paid" } as const;

export default async function CallsAnalyticsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Calls Analytics" />;
  const tab = callTab(one(sp.tab));
  const meta = CALL_TABS.find((t) => t.id === tab)!;
  const ctx = await reportContext(brand, sp);
  const v = await callsView(ctx);
  const info = v.info ?? FALLBACK;
  const range = rangeLabel(ctx.filters.range);
  const channelsHref = `/cx/settings/channels?brand=${encodeURIComponent(brand.id)}`;
  const base = engagementBase(ctx, "tickets", { mediaType: "phone" });
  const d = (extra: Partial<DrillSpec>, label: string): DrillSpec => ({ ...base, ...extra, title: `Phone tickets · ${label} · ${range}` });
  const showPhone = v.everCalls > 0 && tab !== "live-status";
  const agentTab = tab === "agent-performance" || tab === "agentwise";

  return (
    <ReportFrame
      ctx={ctx}
      switcher={switcher}
      page="calls"
      title="Calls Analytics"
      description="Call volume, agent performance and live agent status from your telephony provider."
      source={v.available ? "Source: telephony provider" : "Telephony not connected"}
      filters={{ scope: false, media: false, date: tab !== "live-status" }}
    >
      <TabsNav items={CALL_TABS.map((t) => ({ href: `/cx/reports/calls?tab=${t.id}`, label: t.label }))} />

      {showPhone && (
        <>
          {!agentTab && (
            <>
              <Widget
                id="cx-reports.calls.phone-tiles"
                title="Phone Tickets"
                bare
                table={{ columns: ["Metric", "Tickets"], rows: [["Phone tickets", v.calls], ["Open", v.stats.open], ["Assigned", v.stats.assigned], ["Responded", v.stats.responded], ["Resolved", v.stats.solved], ["Closed", v.stats.closed]] }}
              >
                <p className="mb-2 text-[12.5px] text-text-3">Tickets on phone channels created in {range}. Call durations, outcomes and wait times need a telephony connection.</p>
                <TileRow
                  cols={6}
                  size="md"
                  tiles={[
                    { key: "total", label: "Phone tickets", value: v.calls.toLocaleString("en-US"), drill: v.calls ? d({ status: "total" }, "All") : null },
                    ...(["open", "assigned", "responded", "solved", "closed"] as const).map((k) => ({
                      key: `ph-${k}`,
                      label: { open: "Open", assigned: "Assigned", responded: "Responded", solved: "Resolved", closed: "Closed" }[k],
                      value: v.stats[k].toLocaleString("en-US"),
                      drill: v.stats[k] ? d({ status: k }, { open: "Open", assigned: "Assigned", responded: "Responded", solved: "Resolved", closed: "Closed" }[k]) : null,
                    })),
                  ]}
                />
              </Widget>
              <Widget
                id="cx-reports.calls.phone-trend"
                title="Phone Tickets Over Time"
                actions={<IntervalSelect value={ctx.filters.interval} />}
                table={{ columns: ["Period", "Phone tickets"], rows: v.trend.map((r) => [dmy(r.key), Number(r.calls ?? 0)]) }}
                insight={{ metric: "Phone tickets", range, rows: v.trend.map((r) => ({ key: r.key, value: Number(r.calls ?? 0) })), total: v.calls, previous: null }}
              >
                <LineChartK data={v.trend} series={[{ key: "calls", label: "Phone tickets", color: "var(--series-1)" }]} drill={{ base, x: "bucket" }} interval={ctx.filters.interval} yLabel="Number of tickets" height={260} shared={false} legend={false} />
              </Widget>
            </>
          )}
          {agentTab && (
            <Widget
              id="cx-reports.calls.phone-agents"
              title="Phone Tickets by Agent"
              info="Assignee of each phone ticket created in the period. Talk time and call outcomes need a telephony connection."
              table={{ columns: ["Agent", "Phone tickets"], rows: v.byAgent.map((a) => [a.name, a.calls]) }}
            >
              <DrillTableK
                empty={`No phone tickets in ${range}.`}
                columns={[{ label: "Agent" }, { label: "Phone tickets" }]}
                rows={v.byAgent.map((a): KCell[] => [{ v: a.name }, { v: a.calls.toLocaleString("en-US"), drill: d({ agent: a.id, status: "total" }, a.name) }])}
              />
            </Widget>
          )}
        </>
      )}

      <Widget id={`cx-reports.calls.${tab}-connect`} title={meta.label} actions={<Badge tone={v.available ? "good" : "neutral"}>{v.available ? "Connected" : "Not connected"}</Badge>}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
          <div className="min-w-0">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
                <PhoneCall className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold text-text">{v.available ? `No call data for ${meta.label} yet` : `Connect telephony to see ${meta.label}`}</h3>
                <p className="mt-0.5 text-[13px] text-text-2">{meta.summary}</p>
              </div>
            </div>
            <div className="mt-4 text-[11px] font-semibold tracking-[0.08em] text-text-2 uppercase">What this tab will show</div>
            <ul className="mt-2 space-y-1.5">
              {meta.metrics.map((m) => (
                <li key={m} className="flex items-start gap-2 text-[13px] text-text">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-good-ink" aria-hidden />
                  {m}
                </li>
              ))}
            </ul>
            {v.everCalls === 0 && <p className="mt-4 text-[12.5px] text-text-3">No phone tickets are stored for this brand, so nothing is estimated here.</p>}
          </div>
          <div className="min-w-0 rounded-lg border border-border bg-surface-2 p-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-text">
              <PlugZap className="h-4 w-4 text-text-3" aria-hidden /> {info.name}
              <Badge tone={info.cost === "free" ? "good" : info.cost === "paid" ? "warning" : "info"} className="ml-auto">{COST[info.cost]}</Badge>
            </div>
            <dl className="mt-3 space-y-2.5 text-[13px]">
              <div>
                <dt className="text-[11px] font-semibold tracking-[0.08em] text-text-3 uppercase">API</dt>
                <dd className="text-text">{info.api}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold tracking-[0.08em] text-text-3 uppercase">Cost</dt>
                <dd className="text-text">{info.costNote}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold tracking-[0.08em] text-text-3 uppercase">Server settings</dt>
                <dd className="text-text">
                  {info.env.length ? (
                    <span className="flex flex-wrap gap-1.5">
                      {info.env.map((e) => <code key={e} className="rounded bg-surface-3 px-1.5 py-0.5 text-[12px] break-all">{e}</code>)}
                    </span>
                  ) : (
                    <span className="text-text-2">None defined yet</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold tracking-[0.08em] text-text-3 uppercase">Setup</dt>
                <dd className="text-text-2">{info.setup}</dd>
              </div>
            </dl>
            <ButtonLink href={channelsHref} variant="primary" size="sm" className="mt-4">
              Go to Settings → Channels
            </ButtonLink>
          </div>
        </div>
      </Widget>
    </ReportFrame>
  );
}
