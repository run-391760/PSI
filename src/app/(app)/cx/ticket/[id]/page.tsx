import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { TicketView } from "@/components/cx/inbox/ticket-view";
import { NoBrand } from "@/components/cx/inbox/ui";
import { Page, PageHeader } from "@/components/shell/page";
import { requirePageUser } from "@/lib/auth";
import { aiConfigured } from "@/lib/cx/ai";
import { getClassificationTree, getFieldDefs } from "@/lib/cx/admin/fields";
import { listQuickActions } from "@/lib/cx/admin/quick-actions";
import { cxContext } from "@/lib/cx/context";
import { ticketSignals } from "@/lib/cx/insights/signals";
import { getInboxSettings, getPrefs } from "@/lib/cx/inbox/settings";
import { getTicket, listAgents, listCanned, listSeverities, listTeams, listTickets } from "@/lib/cx/inbox/store";
import { emailChannel, emailSuggestions, getSignature } from "@/lib/cx/inbox/workspace";
import { ticketBookmarks } from "@/lib/cx/ops/bookmarks";
import { listTasks } from "@/lib/cx/ops/tasks";

export const metadata: Metadata = { title: "Ticket" };

/**
 * One Ticket View: `/cx/ticket/<ticketId>?brand=<brandId>` (stable URL; linked from every card, the inbox list,
 * search results and the report drill-down drawer). `&act=compose|child|task` opens that dialog on load.
 */
export default async function TicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Ticket" breadcrumbs={[{ label: "CX" }, { label: "Ticket" }]} redirect={`/cx/ticket/${encodeURIComponent(id)}`} />;
  const detail = await getTicket(brand.id, id);
  if (!detail) notFound();
  const t = detail.ticket;
  const [defs, tree, agents, teams, canned, prefs, settings, signature, usedSeverities, suggestions, mailCh, rows, signals, tasks, bookmarks, quick] = await Promise.all([
    getFieldDefs(brand.id).catch(() => []),
    getClassificationTree(brand.id).catch(() => []),
    listAgents(brand.id),
    listTeams(brand.id),
    listCanned(brand.id),
    getPrefs(user.id),
    getInboxSettings(brand.id),
    getSignature(brand.id, user.id),
    listSeverities(brand.id),
    emailSuggestions(brand.id),
    emailChannel(brand.id),
    listTickets(brand.id, user.id, { view: "all" }, 1, { ids: [t.id] }),
    ticketSignals(brand.id, t.id).catch(() => null),
    listTasks(brand.id, user.id, { ticketId: t.id }),
    ticketBookmarks(user.id, t.id),
    listQuickActions(brand.id).catch(() => []),
  ]);
  const fieldDefs = defs.filter((d) => d.scope === "ticket");
  const sevDef = defs.find((d) => d.key.toLowerCase() === "severity" && d.options.length);
  const severities = [...new Set([...(sevDef?.options ?? ["Low", "Medium", "High", "Critical"]), ...usedSeverities])];
  const act = typeof sp.act === "string" ? sp.act : null;
  return (
    <Page wide>
      <PageHeader
        title={<><span className="font-normal text-text-3">#{t.number}</span> {t.subject}</>}
        breadcrumbs={[{ label: "CX" }, { label: "Tickets", href: `/cx/inbox?brand=${brand.id}` }, { label: `Ticket ${t.number}` }]}
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
        className="mb-3"
      />
      <TicketView
        prefs={prefs}
        brand={{ id: brand.id, name: brand.name }}
        me={{ id: user.id, name: user.name || user.email }}
        role={brand.role}
        detail={detail}
        mediaType={rows[0]?.media_type ?? "other"}
        backHref={`/cx/inbox?brand=${brand.id}`}
        tickets={rows}
        agents={agents}
        teams={teams}
        canned={canned}
        ai={aiConfigured()}
        settings={settings}
        severities={severities}
        hasSignature={signature.enabled && (!!signature.body.trim() || !!signature.imageFileId)}
        hasEmail={!!mailCh}
        emailSuggestions={suggestions}
        fieldDefs={fieldDefs.filter((d) => !d.hidden)}
        tree={tree}
        signals={signals}
        quickActions={quick.map((q) => ({ id: q.id, name: q.name, description: q.description }))}
        ops={{ tasks, bookmarks }}
        act={act}
      />
    </Page>
  );
}
