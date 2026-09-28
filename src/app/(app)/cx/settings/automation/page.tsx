import type { Metadata } from "next";
import { AutomationClient } from "@/components/cx/inbox/automation-client";
import { Page } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { TabsNav } from "@/components/ui/tabs";
import { listAutomations } from "@/lib/cx/admin/automation";
import { listQuickActions } from "@/lib/cx/admin/quick-actions";
import { listRules } from "@/lib/cx/inbox/automation";
import { listAgents, listCanned, listTeams } from "@/lib/cx/inbox/store";
import { AdminHeader, adminPage, tabHref } from "../_admin/shell";
import { editorRefs } from "../_admin/refs";
import { AutomationsPanel, QuickActionsPanel } from "./v2-client";

export const metadata: Metadata = { title: "Automation" };
const PATH = "/cx/settings/automation";

export default async function AutomationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { el, ctx } = await adminPage(await searchParams, { title: "Automation", path: PATH, perm: "page:settings.automation" });
  if (!ctx) return el;
  const { brand } = ctx;
  const tab = ctx.tab ?? "automations";
  const [autos, quick, rules, canned] = await Promise.all([listAutomations(brand.id), listQuickActions(brand.id), listRules(brand.id), listCanned(brand.id)]);
  return (
    <Page>
      <AdminHeader
        title="Automation" brand={brand} switcher={ctx.switcher} crumbs={ctx.crumbs}
        description="Automations act on new tickets and customer replies; quick actions are one-click macros for agents; classic routing rules and canned responses keep working alongside."
        meta={<><Badge tone="info">{autos.filter((a) => a.active).length} active automations</Badge><Badge>{quick.length} quick actions</Badge></>}
      />
      <TabsNav className="mb-4" items={[
        { href: tabHref(PATH, brand.id, "automations"), label: "Automations", count: autos.length },
        { href: tabHref(PATH, brand.id, "quick"), label: "Quick actions", count: quick.length },
        { href: tabHref(PATH, brand.id, "routing"), label: "Routing & canned", count: rules.length + canned.length },
      ]} />
      {tab === "routing" ? (
        <RoutingTab brand={brand.id} rules={rules} canned={canned} />
      ) : tab === "quick" ? (
        <QuickActionsPanel brand={brand.id} list={quick} refs={await editorRefs(brand.id, ctx.switcher)} />
      ) : (
        <AutomationsPanel brand={brand.id} list={autos} refs={await editorRefs(brand.id, ctx.switcher)} />
      )}
    </Page>
  );
}

async function RoutingTab({ brand, rules, canned }: { brand: string; rules: Awaited<ReturnType<typeof listRules>>; canned: Awaited<ReturnType<typeof listCanned>> }) {
  const [agents, teams] = await Promise.all([listAgents(brand), listTeams(brand)]);
  return <AutomationClient brand={brand} rules={rules} canned={canned} agents={agents} teams={teams} />;
}
