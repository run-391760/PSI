import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Page } from "@/components/shell/page";
import { TabsNav } from "@/components/ui/tabs";
import { classificationUsage, ensureSystemFields, getClassificationTree, getFieldDefs } from "@/lib/cx/admin/fields";
import { AdminHeader, adminPage, tabHref } from "../_admin/shell";
import { ClassificationPanel, FieldsPanel, PicklistsPanel } from "./fields-client";

export const metadata: Metadata = { title: "Fields & classification" };
const PATH = "/cx/settings/fields";

export default async function FieldsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { el, ctx } = await adminPage(await searchParams, { title: "Fields & classification", path: PATH, perm: "page:settings.fields" });
  if (!ctx) return el;
  const { brand } = ctx;
  await ensureSystemFields(brand.id);
  const [tree, defs, usage] = await Promise.all([getClassificationTree(brand.id), getFieldDefs(brand.id), classificationUsage(brand.id)]);
  const custom = defs.filter((d) => d.group !== "system");
  const tab = ctx.tab ?? "classification";
  return (
    <Page>
      <AdminHeader
        title="Fields & classification" brand={brand} switcher={ctx.switcher} crumbs={ctx.crumbs}
        description="The data model agents fill on tickets: a three-level classification with sentiment per level, Additional Info fields with validation and encryption, Custom Info masters and system picklists."
        meta={<><Badge tone="info">{tree.length} classifications</Badge><Badge>{custom.length} fields</Badge></>}
      />
      <TabsNav className="mb-4" items={[
        { href: tabHref(PATH, brand.id, "classification"), label: "Classification", count: tree.length },
        { href: tabHref(PATH, brand.id, "fields"), label: "Additional & Custom Info", count: custom.length },
        { href: tabHref(PATH, brand.id, "picklists"), label: "Picklists" },
      ]} />
      {tab === "fields" ? <FieldsPanel brand={brand.id} defs={custom} /> : tab === "picklists" ? <PicklistsPanel brand={brand.id} defs={defs.filter((d) => d.group === "system")} /> : <ClassificationPanel brand={brand.id} nodes={tree} usage={usage} />}
    </Page>
  );
}
