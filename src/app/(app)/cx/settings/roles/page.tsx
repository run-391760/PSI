import type { Metadata } from "next";
import { Page } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { TabsNav } from "@/components/ui/tabs";
import { listAudit } from "@/lib/cx/admin/audit";
import { listRoles, memberRoles } from "@/lib/cx/admin/roles";
import { adminSettings } from "@/lib/cx/admin/settings";
import { listMembers } from "@/lib/cx/insights/team";
import { AdminHeader, adminPage, tabHref } from "../_admin/shell";
import { AuditPanel, MembersPanel, RolesPanel, SecurityPanel } from "./roles-client";

export const metadata: Metadata = { title: "Roles & security" };
const PATH = "/cx/settings/roles";

export default async function RolesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { el, ctx } = await adminPage(await searchParams, { title: "Roles & security", path: PATH, perm: "page:settings.roles" });
  if (!ctx) return el;
  const { brand } = ctx;
  const tab = ctx.tab ?? "roles";
  const [roles, members, settings] = await Promise.all([listRoles(brand.id), listMembers(brand.id), adminSettings(brand.id)]);
  return (
    <Page>
      <AdminHeader
        title="Roles & security" brand={brand} switcher={ctx.switcher} crumbs={ctx.crumbs}
        description="Custom roles with page and action permissions, bulk member import, data masking and outbound email rules, and the audit log of admin changes."
        meta={<><Badge tone="info">{roles.length} custom roles</Badge><Badge>{members.length} members</Badge>{settings.piiMask && <Badge tone="good">PII masked</Badge>}</>}
      />
      <TabsNav className="mb-4" items={[
        { href: tabHref(PATH, brand.id, "roles"), label: "Roles", count: roles.length },
        { href: tabHref(PATH, brand.id, "members"), label: "Members", count: members.length },
        { href: tabHref(PATH, brand.id, "security"), label: "Security" },
        { href: tabHref(PATH, brand.id, "audit"), label: "Audit log" },
      ]} />
      {tab === "members" ? <MembersPanel brand={brand.id} members={members} roles={roles} assigned={await memberRoles(brand.id)} />
        : tab === "security" ? <SecurityPanel brand={brand.id} settings={{ piiMask: settings.piiMask, allowedDomains: settings.allowedDomains, statusRequiredWithReply: settings.statusRequiredWithReply }} />
        : tab === "audit" ? <AuditPanel rows={await listAudit(brand.id)} members={members} />
        : <RolesPanel brand={brand.id} roles={roles} />}
    </Page>
  );
}
