import type { Metadata } from "next";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { AutomationClient } from "@/components/cx/inbox/automation-client";
import { NoBrand } from "@/components/cx/inbox/ui";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { listRules } from "@/lib/cx/inbox/automation";
import { listAgents, listCanned, listTeams } from "@/lib/cx/inbox/store";

export const metadata: Metadata = { title: "Automation" };

export default async function AutomationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX" }, { label: "Settings" }, { label: "Automation" }];
  if (!brand) return <NoBrand title="Automation" breadcrumbs={crumbs} redirect="/cx/settings/automation" />;
  const [rules, canned, agents, teams] = await Promise.all([listRules(brand.id), listCanned(brand.id), listAgents(brand.id), listTeams(brand.id)]);
  return (
    <Page>
      <PageHeader
        title="Automation"
        subject={brand.name}
        breadcrumbs={crumbs}
        description="Rules run on every new ticket from any channel: routing assigns a team, agent and priority; auto-tagging labels tickets by keywords, intent, sentiment or language. Canned responses speed up replies."
        meta={
          <>
            <Badge tone="info">{rules.filter((r) => r.kind === "route" && r.active).length} routing rules</Badge>
            <Badge tone="info">{rules.filter((r) => r.kind === "tag" && r.active).length} tag rules</Badge>
            <Badge>{canned.length} canned responses</Badge>
          </>
        }
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
      />
      <AutomationClient brand={brand.id} rules={rules} canned={canned} agents={agents} teams={teams} />
    </Page>
  );
}
