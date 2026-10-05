import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { TabsNav } from "@/components/ui/tabs";
import { getQueueSettings, listStatuses, queueAgents, statusLog, teamZones, waitingTickets } from "@/lib/cx/admin/queue";
import { adminSettings } from "@/lib/cx/admin/settings";
import { listUserGroups } from "@/lib/cx/admin/users";
import { AdminHeader, adminPage, tabHref } from "../_admin/shell";
import { QueueAgentsPanel, QueueSettingsPanel, SegmentsPanel, StatusesPanel, WaitingPanel } from "./queue-client";

export const metadata: Metadata = { title: "Queue & assignment" };
const PATH = "/cx/settings/queue";

export default async function QueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { el, ctx } = await adminPage(await searchParams, { title: "Queue & assignment", path: PATH, perm: "page:settings.queue" });
  if (!ctx) return el;
  const { brand } = ctx;
  const tab = ctx.tab ?? "settings";
  const [settings, agents, statuses, admin, waiting] = await Promise.all([getQueueSettings(brand.id), queueAgents(brand.id), listStatuses(brand.id), adminSettings(brand.id), waitingTickets(brand.id)]);
  const { rrCursor: _c, ...s } = settings;
  void _c;
  const timer = { showQueueTimer: admin.showQueueTimer, queueTimerMinutes: admin.queueTimerMinutes };
  const available = agents.filter((a) => a.status === "available" && !a.paused).length;
  return (
    <Page>
      <AdminHeader
        title="Queue & assignment" brand={brand} switcher={ctx.switcher} crumbs={ctx.crumbs}
        description="Hand tickets to agents automatically: five assignment types, per-agent limits and office hours, breaks with time limits, customer segments and queue cleanup."
        meta={<><Badge tone={settings.enabled ? "good" : "neutral"}>{settings.enabled ? "Queue on" : "Queue off"}</Badge><Badge>{available} of {agents.length} agents available</Badge><Badge tone="info">{waiting.filter((w) => !w.queue_agent).length} waiting</Badge></>}
      />
      <TabsNav className="mb-4" items={[
        { href: tabHref(PATH, brand.id, "settings"), label: "Settings" },
        { href: tabHref(PATH, brand.id, "agents"), label: "Agents", count: agents.length },
        { href: tabHref(PATH, brand.id, "statuses"), label: "Statuses & hours", count: statuses.length },
        { href: tabHref(PATH, brand.id, "segments"), label: "Segments", count: settings.segments.length },
        { href: tabHref(PATH, brand.id, "live"), label: "Live queue", count: waiting.length },
      ]} />
      {tab === "agents" ? <QueueAgentsPanel brand={brand.id} agents={agents} statuses={statuses} />
        : tab === "statuses" ? <StatusesPanel brand={brand.id} statuses={statuses} zones={await teamZones(brand.id)} />
        : tab === "segments" ? <SegmentsPanel brand={brand.id} settings={s} timer={timer} userGroups={(await listUserGroups(brand.id)).map((g) => ({ id: g.id, name: g.name, members: g.memberIds.length }))} />
        : tab === "live" ? <WaitingPanel brand={brand.id} waiting={waiting} agents={agents} log={await statusLog(brand.id)} timerMinutes={admin.queueTimerMinutes} />
        : <QueueSettingsPanel brand={brand.id} settings={s} timer={timer} />}
    </Page>
  );
}
