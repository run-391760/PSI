import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { CX_SETTINGS } from "@/components/shell/cx-nav";
import { DisplaySettings } from "@/components/shell/display-settings";
import { Page, PageHeader } from "@/components/shell/page";
import { BrandMeta, cxHref } from "@/components/cx/insights/common";

export const metadata: Metadata = { title: "CX Settings" };

/** Settings hub: every CX admin page in one place, plus display preferences and hidden menu items. */
export default async function CxSettingsPage({ searchParams }: PageProps<"/cx/settings">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  const link = (h: string) => (brand && h.startsWith("/cx") ? cxHref(h, brand.id) : h);
  const sections = CX_SETTINGS.map((s) => ({ ...s, items: s.items.filter((i) => !i.pending) })).filter((s) => s.items.length);

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX", href: brand ? cxHref("/cx", brand.id) : "/cx" }, { label: "Settings" }]}
        title="Settings"
        subject={brand?.name}
        description="Channels, team, automation and data for this brand, plus how the workspace looks for you."
        meta={brand ? <BrandMeta switcher={switcher} current={brand.id} /> : undefined}
      />
      <div className="mb-6 grid grid-cols-1 gap-x-4 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
        {sections.map((s) => (
          <section key={s.id} className="min-w-0">
            <h2 className="mb-2 text-[11.5px] font-semibold tracking-wide text-text-3 uppercase">{s.label}</h2>
            <ul className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
              {s.items.map((i) => (
                <li key={i.href} className="border-b border-border last:border-0">
                  <Link href={link(i.href)} className="group flex items-center gap-3 px-3.5 py-2.5 hover:bg-surface-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-3 text-text-2">
                      <i.icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-text">{i.label}</span>
                      <span className="block truncate text-[12px] text-text-3">{i.description}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-text-3 group-hover:text-text" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <h2 className="mb-2 text-[11.5px] font-semibold tracking-wide text-text-3 uppercase">Your workspace</h2>
      <DisplaySettings brand={brand?.id} />
    </Page>
  );
}
