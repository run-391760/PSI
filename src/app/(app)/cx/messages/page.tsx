import type { Metadata } from "next";
import Link from "next/link";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { NoBrand } from "@/components/cx/inbox/ui";
import { CardStream } from "@/components/cx/inbox/stream-page";
import { Page, PageHeader } from "@/components/shell/page";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { streamPageData } from "@/lib/cx/inbox/page-data";
import { parseStreamFilters } from "@/lib/cx/inbox/stream";
import { allMessagesStream } from "@/lib/cx/inbox/streams";
import { num } from "@/lib/format";

export const metadata: Metadata = { title: "All messages" };

/** All Messages (Konnect MESSAGES → All Messages): every inbound ticket message and listening mention as cards. */
export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX" }, { label: "Messages" }, { label: "All messages" }];
  if (!brand) return <NoBrand title="All messages" breadcrumbs={crumbs} redirect="/cx/messages" />;
  const f = { ...parseStreamFilters(sp), channel: typeof sp.channel === "string" ? sp.channel : undefined, scope: typeof sp.scope === "string" ? sp.scope : undefined };
  const [data, stream] = await Promise.all([streamPageData(brand, user), allMessagesStream(brand.id, user.id, f, 30)]);
  return (
    <Page wide>
      <PageHeader title="All messages" subject={brand.name} breadcrumbs={crumbs} meta={<span className="text-[12.5px] text-text-3">{num(stream.total)} items · ticket messages and listening mentions</span>} actions={<BrandSwitcher brands={switcher} current={brand.id} />} className="mb-4" />
      <CardStream
        ctx={data.ctx} prefs={data.prefs} cards={stream.cards} facets={stream.facets} variant="message" scopeOptions={data.scope}
        more={{ sentiment: true, direction: true, languages: data.options.languages, assignees: data.options.assignees, priority: true, tags: data.options.tags, attach: true, classifications: data.options.classifications, kind: [["message", "Ticket messages"], ["mention", "Listening mentions"]] }}
        total={stream.total} page={stream.page} pageSize={stream.pageSize}
        empty={{ title: "No messages match", description: "Inbound messages from your channels and mentions from listening topics appear here. Widen the date range or clear filters.", action: <Link className="text-[13px] text-link hover:underline" href={`/cx/listening/topics?brand=${brand.id}`}>Set up listening topics →</Link> }}
      />
    </Page>
  );
}
