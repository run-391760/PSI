import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { TabsNav } from "@/components/ui/tabs";
import { alertLog, getIntegrations, listAlerts } from "@/lib/cx/admin/alerts";
import { AdminHeader, adminPage, tabHref } from "../_admin/shell";
import { editorRefs } from "../_admin/refs";
import { AlertLogPanel, AlertsPanel, IntegrationsPanel } from "./alerts-client";

export const metadata: Metadata = { title: "Alerts" };
const PATH = "/cx/settings/alerts";

export default async function AlertsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { el, ctx } = await adminPage(await searchParams, { title: "Alerts", path: PATH, perm: "page:settings.alerts" });
  if (!ctx) return el;
  const { brand } = ctx;
  const tab = ctx.tab ?? "alerts";
  const [alerts, integrations] = await Promise.all([listAlerts(brand.id), getIntegrations(brand.id)]);
  return (
    <Page>
      <AdminHeader
        title="Alerts" brand={brand} switcher={ctx.switcher} crumbs={ctx.crumbs}
        description="Keyword, channel and sentiment alerts on new tickets and listening mentions, delivered in the app, by email (with a CSV if you like), to Slack or to Telegram."
        meta={<><Badge tone="info">{alerts.filter((a) => a.active).length} active</Badge><Badge tone={integrations.slack.connected ? "good" : "neutral"}>Slack</Badge><Badge tone={integrations.telegram.connected ? "good" : "neutral"}>Telegram</Badge></>}
      />
      <TabsNav className="mb-4" items={[
        { href: tabHref(PATH, brand.id, "alerts"), label: "Alerts", count: alerts.length },
        { href: tabHref(PATH, brand.id, "integrations"), label: "Slack & Telegram" },
        { href: tabHref(PATH, brand.id, "log"), label: "Delivery log" },
      ]} />
      {tab === "integrations" ? <IntegrationsPanel brand={brand.id} integrations={integrations} />
        : tab === "log" ? <AlertLogPanel log={await alertLog(brand.id, 100)} />
        : <AlertsPanel brand={brand.id} alerts={alerts} integrations={integrations} channels={(await editorRefs(brand.id, ctx.switcher)).channels} />}
    </Page>
  );
}
