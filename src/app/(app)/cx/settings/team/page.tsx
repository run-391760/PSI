import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { cxContext } from "@/lib/cx/context";
import { PRIORITIES, slaCompliance, type TicketTimes } from "@/lib/cx/insights/metrics";
import { slaTargetMap } from "@/lib/cx/insights/sla";
import { getHours, listMembers, listSlaPolicies, listTeams } from "@/lib/cx/insights/team";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { TabsNav } from "@/components/ui/tabs";
import { BrandMeta, NoBrand, cxHref } from "@/components/cx/insights/common";
import { HoursPanel, MembersPanel, SlaPanel, TeamsPanel } from "@/components/cx/insights/team-settings";

export const metadata: Metadata = { title: "Team & SLAs" };

export default async function TeamPage({ searchParams }: PageProps<"/cx/settings/team">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Team & SLAs" breadcrumbs={[{ label: "CX" }, { label: "Settings" }, { label: "Team & SLAs" }]} />;
  const tab = typeof sp.tab === "string" ? sp.tab : "members";
  const [members, teams, hours, policies] = await Promise.all([listMembers(brand.id), listTeams(brand.id), getHours(brand.id), listSlaPolicies(brand.id)]);

  let stats: Record<string, ReturnType<typeof slaCompliance>> = {};
  if (tab === "sla") {
    const [tickets, map] = await Promise.all([
      query<TicketTimes>("SELECT priority,created_at,first_response_at,resolved_at,first_response_due,resolution_due FROM cx_tickets WHERE project_id=$1 AND created_at > now() - interval '30 days'", [brand.id]),
      slaTargetMap(brand.id),
    ]);
    stats = Object.fromEntries(PRIORITIES.map((p) => [p, slaCompliance(tickets.filter((t) => t.priority === p), new Date(), map)]));
  }
  const h = (t: string) => cxHref("/cx/settings/team", brand.id, { tab: t });

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX", href: cxHref("/cx", brand.id) }, { label: "Settings" }, { label: "Team & SLAs" }]}
        title="Team & SLAs"
        subject={brand.name}
        description="Who works on this brand, when you are open, and how fast you promise to respond."
        meta={
          <BrandMeta switcher={switcher} current={brand.id}>
            <Badge tone="neutral">{members.length} member{members.length === 1 ? "" : "s"}</Badge>
            <Badge tone={policies.length ? "good" : "warning"}>{policies.length ? `${policies.length} SLA polic${policies.length === 1 ? "y" : "ies"}` : "No SLA policies"}</Badge>
          </BrandMeta>
        }
      />
      <TabsNav
        className="mb-4"
        items={[
          { href: h("members"), label: "Members", count: members.length },
          { href: h("teams"), label: "Teams", count: teams.length },
          { href: h("hours"), label: "Business hours" },
          { href: h("sla"), label: "SLA policies", count: policies.length },
        ]}
      />
      {tab === "teams" ? (
        <TeamsPanel brand={brand.id} teams={teams} />
      ) : tab === "hours" ? (
        <HoursPanel brand={brand.id} timezone={hours.timezone} hours={hours.hours} holidays={hours.holidays} />
      ) : tab === "sla" ? (
        <SlaPanel brand={brand.id} policies={policies} stats={stats} />
      ) : (
        <MembersPanel brand={brand.id} members={JSON.parse(JSON.stringify(members))} teams={JSON.parse(JSON.stringify(teams))} />
      )}
    </Page>
  );
}
