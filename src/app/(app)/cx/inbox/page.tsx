import type { Metadata } from "next";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { InboxClient } from "@/components/cx/inbox/inbox-client";
import { NoBrand } from "@/components/cx/inbox/ui";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { requirePageUser } from "@/lib/auth";
import { aiConfigured } from "@/lib/cx/ai";
import { cxContext } from "@/lib/cx/context";
import { getClassificationTree, getFieldDefs } from "@/lib/cx/admin/fields";
import { query } from "@/lib/db";
import { listQuickActions } from "@/lib/cx/admin/quick-actions";
import { ticketSignals } from "@/lib/cx/insights/signals";
import { getInboxSettings, getPrefs } from "@/lib/cx/inbox/settings";
import { listCanned, listAgents, listSeverities, listTags, listTeams, listTickets, getTicket, inboxStats, slaPolicyCount, viewCounts, VIEWS, type View } from "@/lib/cx/inbox/store";
import { emailChannel, emailSuggestions, fireDueReminders, getSignature } from "@/lib/cx/inbox/workspace";
import { listChannels } from "@/lib/cx/inbox/channels";
import { ensureInboxJobs } from "@/lib/cx/inbox/jobs";

export const metadata: Metadata = { title: "Inbox & tickets" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX" }, { label: "Inbox & tickets" }];
  if (!brand) return <NoBrand title="Inbox & tickets" breadcrumbs={crumbs} redirect="/cx/inbox" />;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const view = (VIEWS.some((v) => v.id === s("view")) ? s("view") : "open") as View;
  const filters = {
    view, q: s("q"), channel: s("channel"), priority: s("priority"), status: s("status"), tag: s("tag"), team: s("team"), sentiment: s("sentiment"),
    from: s("from"), to: s("to"), profile: s("profile"), topic: s("topic"), escalated: s("escalated"), email: s("email"), severity: s("severity"), assignee: s("assignee"), sort: s("sort"),
  };
  const channels = await listChannels(brand.id);
  await ensureInboxJobs(brand.id, user.id, channels.some((c) => c.kind === "email" && c.status !== "paused")).catch(() => {});
  await fireDueReminders(brand.id).catch(() => 0);
  const [defs, tree] = await Promise.all([getFieldDefs(brand.id).catch(() => []), getClassificationTree(brand.id).catch(() => [])]);
  const fieldDefs = defs.filter((d) => d.scope === "ticket");
  const [tickets, counts, stats, agents, teams, tags, canned, policies, prefs, settings, signature, usedSeverities, suggestions, mailCh, topics] = await Promise.all([
    listTickets(brand.id, user.id, filters, 300, { fieldKeys: fieldDefs.map((d) => d.key) }),
    viewCounts(brand.id, user.id),
    inboxStats(brand.id),
    listAgents(brand.id),
    listTeams(brand.id),
    listTags(brand.id),
    listCanned(brand.id),
    slaPolicyCount(brand.id),
    getPrefs(user.id),
    getInboxSettings(brand.id),
    getSignature(brand.id, user.id),
    listSeverities(brand.id),
    emailSuggestions(brand.id),
    emailChannel(brand.id),
    query<{ id: string; name: string }>("SELECT id,name FROM cx_topics WHERE project_id=$1 ORDER BY name", [brand.id]),
  ]);
  // Severity options: the admin-defined "severity" field (Settings → Fields) when present, else a standard scale.
  const sevDef = defs.find((d) => d.key.toLowerCase() === "severity" && d.options.length);
  const severities = [...new Set([...(sevDef?.options ?? ["Low", "Medium", "High", "Critical"]), ...usedSeverities])];
  const ticketId = s("t") ?? s("ticket"); // ?ticket= is the deep link used by Listening
  const selected = ticketId ? await getTicket(brand.id, ticketId) : null;
  const signals = selected ? await ticketSignals(brand.id, selected.ticket.id).catch(() => null) : null;
  const quickActions = (await listQuickActions(brand.id).catch(() => [])).map((q) => ({ id: q.id, name: q.name, description: q.description }));
  return (
    <Page wide>
      <PageHeader
        title="Inbox & tickets"
        subject={brand.name}
        breadcrumbs={crumbs}
        meta={
          <>
            <Badge tone="info">{channels.filter((c) => c.status !== "paused").length} channels</Badge>
            <Badge>{policies ? `SLA policies for ${policies} of 4 priorities (others: 1h / 24h)` : "Default SLA: 1h first response · 24h resolution"}</Badge>
          </>
        }
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
      />
      <InboxClient
        brand={{ id: brand.id, name: brand.name }}
        me={{ id: user.id, name: user.name || user.email }}
        filters={filters}
        tickets={tickets}
        counts={counts}
        stats={stats}
        agents={agents}
        teams={teams}
        tags={tags}
        canned={canned}
        channels={channels.map((c) => ({ id: c.id, kind: c.kind, name: c.name }))}
        selected={selected}
        ai={aiConfigured()}
        role={brand.role}
        topics={topics}
        severities={severities}
        prefs={prefs}
        settings={settings}
        signature={signature}
        hasSignature={signature.enabled && (!!signature.body.trim() || !!signature.imageFileId)}
        hasEmail={!!mailCh}
        emailSuggestions={suggestions}
        fieldDefs={fieldDefs.filter((d) => !d.hidden)}
        tree={tree}
        signals={signals}
        quickActions={quickActions}
      />
    </Page>
  );
}
