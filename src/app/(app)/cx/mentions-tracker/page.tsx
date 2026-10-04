import { Radar } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { NoBrand } from "@/components/cx/inbox/ui";
import { TrackerBoard } from "@/components/cx/ops/tracker-board";
import { TrackerSettings } from "@/components/cx/ops/tracker-settings";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { listTracked, publishingTracked, trackerData } from "@/lib/cx/ops/tracker";
import { num } from "@/lib/format";

export const metadata: Metadata = { title: "Mentions tracker" };

export default async function MentionsTrackerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX" }, { label: "Mentions tracker" }];
  if (!brand) return <NoBrand title="Mentions tracker" breadcrumbs={crumbs} redirect="/cx/mentions-tracker" />;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  const stored = await listTracked(brand.id);
  const published = await publishingTracked(brand.id, stored);
  const tracked = [...stored, ...published];
  const { items, context } = await trackerData(brand.id, tracked);
  const handles = stored.filter((t) => t.kind === "handle");
  const posts = stored.filter((t) => t.kind === "post");
  const canEdit = brand.role !== "viewer";
  const q = `?brand=${brand.id}`;

  const empty = (
    <EmptyState
      icon={<Radar className="h-5 w-5" />}
      title={tracked.length ? "No replies or mentions found yet" : "Start by tracking your handles"}
      description={
        tracked.length
          ? `Scanned ${num(context.scanned)} listening mention${context.scanned === 1 ? "" : "s"} from the last ${context.scanDays} days: none mention your tracked handles or link to your tracked posts${context.metaChannels ? ", and no comments or mentions arrived on your Facebook / Instagram posts" : ""}.`
          : "Add your brand's social handles and the posts you want to watch. Listening mentions that tag a handle or link to a post, and comments on your own Facebook / Instagram posts, are tracked here with their response status."
      }
      action={context.topics === 0 ? <ButtonLink href={`/cx/listening/topics${q}`} size="sm">Set up listening topics</ButtonLink> : undefined}
    />
  );

  return (
    <Page>
      <PageHeader
        title="Mentions tracker"
        subject={brand.name}
        breadcrumbs={crumbs}
        description="Replies and mentions of your own handles and posts, and whether your team responded."
        meta={<Badge tone="neutral">Real data · last {context.scanDays} days</Badge>}
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
      />
      <div className="mb-4 space-y-2">
        {context.topics === 0 ? (
          <Callout tone="info" title="No listening topics yet" action={<ButtonLink href={`/cx/listening/topics${q}`} size="sm">Add topics</ButtonLink>}>
            Mentions of your handles are found by social listening. Add a topic with your brand name or handles to start collecting them.
          </Callout>
        ) : context.mentions === 0 ? (
          <Callout tone="info" title="No listening mentions collected yet">
            Your topics haven&apos;t returned mentions so far. Check them on the <Link href={`/cx/listening${q}`} className="text-link hover:underline">Listening</Link> page.
          </Callout>
        ) : null}
        {context.metaChannels === 0 && (
          <Callout tone="info" title="Facebook and Instagram are not connected" action={<ButtonLink href={`/cx/settings/channels${q}`} size="sm">Connect channels</ButtonLink>}>
            Comments, mentions and tags on your own Facebook / Instagram posts appear here once a Page or Instagram account is connected.
          </Callout>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className={tracked.length ? "min-w-0" : "order-2 min-w-0 xl:order-1"}>
          <TrackerBoard
            brand={brand.id}
            items={items}
            canEdit={canEdit}
            empty={empty}
            initial={{ status: s("status") ?? "", match: s("match") ?? "", source: s("source") ?? "", range: s("range") ?? "90", from: s("from") ?? "", to: s("to") ?? "" }}
          />
        </div>
        <div className={tracked.length ? "min-w-0" : "order-1 min-w-0 xl:order-2"}>
          <TrackerSettings
            brand={brand.id}
            canEdit={canEdit}
            handles={handles.map(({ id, kind, platform, value, label }) => ({ id, kind, platform, value, label }))}
            posts={posts.map(({ id, kind, platform, value, label }) => ({ id, kind, platform, value, label }))}
            published={published}
          />
        </div>
      </div>
    </Page>
  );
}
