import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { NoBrand } from "@/components/cx/inbox/ui";
import { Page, PageHeader } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import type { PagePerm } from "@/lib/cx/admin/pure/permissions";
import { permissionsFor } from "@/lib/cx/admin/roles";

type SP = Record<string, string | string[] | undefined>;

/** Shared loader for admin settings pages: brand context + page permission. */
export async function adminPage(sp: SP, opts: { title: string; path: string; perm: PagePerm }) {
  const user = await requirePageUser();
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX" }, { label: "Settings" }, { label: opts.title }];
  if (!brand) return { el: <NoBrand title={opts.title} breadcrumbs={crumbs} redirect={opts.path} />, ctx: null };
  const { perms } = await permissionsFor(brand.id, user.id);
  if (!perms.includes(opts.perm))
    return {
      el: (
        <Page>
          <PageHeader title={opts.title} subject={brand.name} breadcrumbs={crumbs} actions={<BrandSwitcher brands={switcher} current={brand.id} />} />
          <Card><EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="You don't have access to this page" description="Your role in this brand doesn't include this settings page. Ask a brand admin to update your role." /></Card>
        </Page>
      ),
      ctx: null,
    };
  const tab = typeof sp.tab === "string" ? sp.tab : undefined;
  return { el: null, ctx: { user, brand, switcher, crumbs, perms, tab } };
}

export function AdminHeader({ title, brand, switcher, crumbs, description, meta, actions }: { title: string; brand: { id: string; name: string }; switcher: { id: string; name: string; domain: string }[]; crumbs: { label: string }[]; description: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return <PageHeader title={title} subject={brand.name} breadcrumbs={crumbs} description={description} meta={meta} actions={<div className="flex flex-wrap items-center gap-2">{actions}<BrandSwitcher brands={switcher} current={brand.id} /></div>} />;
}

export const tabHref = (path: string, brand: string, tab: string) => `${path}?brand=${encodeURIComponent(brand)}&tab=${tab}`;
