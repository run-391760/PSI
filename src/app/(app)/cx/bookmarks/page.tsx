import type { Metadata } from "next";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { NoBrand } from "@/components/cx/inbox/ui";
import { BookmarksClient } from "@/components/cx/ops/bookmarks-client";
import { Page, PageHeader } from "@/components/shell/page";
import { TabsNav } from "@/components/ui/tabs";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { listBookmarks } from "@/lib/cx/ops/bookmarks";

export const metadata: Metadata = { title: "Bookmarks" };

export default async function BookmarksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX" }, { label: "Bookmarks" }];
  if (!brand) return <NoBrand title="Bookmarks" breadcrumbs={crumbs} redirect="/cx/bookmarks" />;
  const kind = sp.kind === "ticket" || sp.kind === "message" ? sp.kind : undefined;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const [rows, all] = await Promise.all([listBookmarks(brand.id, user.id, { kind, q }), listBookmarks(brand.id, user.id)]);
  const base = `/cx/bookmarks?brand=${brand.id}`;
  return (
    <Page>
      <PageHeader
        title="Bookmarks"
        subject={brand.name}
        breadcrumbs={crumbs}
        description="Your personal bookmarks: tickets and single messages you saved from the inbox, card view or All messages, with optional notes. Only you see them."
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
      />
      <TabsNav param="kind" className="mb-3" items={[
        { href: base, label: "All", count: all.length },
        { href: `${base}&kind=ticket`, label: "Tickets", count: all.filter((b) => !b.message_id).length },
        { href: `${base}&kind=message`, label: "Messages", count: all.filter((b) => b.message_id).length },
      ]} />
      <BookmarksClient brand={brand.id} rows={rows} q={q ?? ""} />
    </Page>
  );
}
