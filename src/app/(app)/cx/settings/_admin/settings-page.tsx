import { ShieldAlert, ShieldBan } from "lucide-react";
import type { ReactNode } from "react";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { NoBrand } from "@/components/cx/inbox/ui";
import { Page, PageHeader } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { ipBlocked } from "@/lib/cx/admin/ip";
import type { PagePerm } from "@/lib/cx/admin/pure/permissions";
import { permissionsFor } from "@/lib/cx/admin/roles";

type SP = Record<string, string | string[] | undefined>;

/**
 * Loader for the WP-K3 settings pages: brand context, the brand's IP allowlist and (optionally) a page
 * permission. Returns the element to render instead (no brand / blocked / no access) or the context.
 */
export async function settingsPage(sp: SP, opts: { title: string; path: string; perm?: PagePerm | null }) {
  const user = await requirePageUser();
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX", href: brand ? `/cx?brand=${brand.id}` : "/cx" }, { label: "Settings", href: brand ? `/cx/settings?brand=${brand.id}` : "/cx/settings" }, { label: opts.title }];
  if (!brand) return { el: <NoBrand title={opts.title} breadcrumbs={crumbs} redirect={opts.path} />, ctx: null };
  const blocked = await ipBlocked(brand.id, user.id);
  if (blocked)
    return {
      el: (
        <Page>
          <PageHeader title={opts.title} subject={brand.name} breadcrumbs={crumbs} actions={<BrandSwitcher brands={switcher} current={brand.id} />} />
          <Card><EmptyState icon={<ShieldBan className="h-5 w-5" />} title="Your IP address isn't allowed for this brand" description={`This brand only accepts access from approved IP addresses. Your address is ${blocked}. Ask a brand admin to add it under Settings → Users → IP whitelisting.`} /></Card>
        </Page>
      ),
      ctx: null,
    };
  const { perms, base } = await permissionsFor(brand.id, user.id);
  if (opts.perm && !perms.includes(opts.perm))
    return {
      el: (
        <Page>
          <PageHeader title={opts.title} subject={brand.name} breadcrumbs={crumbs} actions={<BrandSwitcher brands={switcher} current={brand.id} />} />
          <Card><EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="You don't have access to this page" description="Your role in this brand doesn't include this settings page. Ask a brand admin to update your role." /></Card>
        </Page>
      ),
      ctx: null,
    };
  return { el: null, ctx: { user, brand, switcher, crumbs, perms, base, canEdit: brand.role !== "viewer" && (!opts.perm || perms.includes(opts.perm)) } };
}

/** Konnect-style page title row: title (+ brand), actions on the right, brand switcher. */
export function SettingsHeader({ title, ctx, description, actions, meta }: { title: string; ctx: { brand: { id: string; name: string }; switcher: { id: string; name: string; domain: string }[]; crumbs: { label: string; href?: string }[] }; description?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <PageHeader
      title={title}
      subject={ctx.brand.name}
      breadcrumbs={ctx.crumbs}
      description={description}
      meta={meta}
      actions={<div className="flex flex-wrap items-center gap-2">{actions}<BrandSwitcher brands={ctx.switcher} current={ctx.brand.id} /></div>}
    />
  );
}

/** Origin of the current request (invite links, embed snippets). */
export async function requestOrigin() {
  const { headers } = await import("next/headers");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3200";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
