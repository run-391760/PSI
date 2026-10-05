import type { Metadata } from "next";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { NoBrand } from "@/components/cx/inbox/ui";
import { CardStream } from "@/components/cx/inbox/stream-page";
import { Page, PageHeader } from "@/components/shell/page";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { streamPageData } from "@/lib/cx/inbox/page-data";
import { parseStreamFilters } from "@/lib/cx/inbox/stream";
import { bookmarkStream } from "@/lib/cx/inbox/streams";
import { num } from "@/lib/format";

export const metadata: Metadata = { title: "Bookmarks" };

/** Bookmarks (Konnect MESSAGES → Bookmarks): the user's bookmarked tickets and messages, as the same cards. */
export default async function BookmarksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX" }, { label: "Messages" }, { label: "Bookmarks" }];
  if (!brand) return <NoBrand title="Bookmarks" breadcrumbs={crumbs} redirect="/cx/bookmarks" />;
  const f = { ...parseStreamFilters(sp), channel: typeof sp.channel === "string" ? sp.channel : undefined, scope: typeof sp.scope === "string" ? sp.scope : undefined };
  const [data, stream] = await Promise.all([streamPageData(brand, user), bookmarkStream(brand.id, user.id, f)]);
  return (
    <Page wide>
      <PageHeader title="Bookmarks" subject={brand.name} breadcrumbs={crumbs}
        meta={<span className="text-[12.5px] text-text-3">{num(stream.tickets)} tickets · {num(stream.messages)} messages · only you see your bookmarks</span>}
        actions={<BrandSwitcher brands={switcher} current={brand.id} />} className="mb-4" />
      <CardStream
        ctx={data.ctx} prefs={data.prefs} cards={stream.cards} facets={stream.facets} variant="bookmark" scopeOptions={data.scope}
        more={{ sentiment: true, assignees: data.options.assignees, kind: [["ticket", "Tickets"], ["message", "Messages"]] }}
        total={stream.cards.length} searchPlaceholder="Search bookmarks, notes, authors"
        empty={stream.total ? { title: "No bookmarks match", description: "Clear the filters to see all your bookmarks." } : { title: "No bookmarks yet", description: "Use the book icon on any ticket or message card (or in a ticket) to save it here." }}
      />
    </Page>
  );
}
