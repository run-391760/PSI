import { Image as ImageIcon } from "lucide-react";
import type { Metadata } from "next";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { ListeningNav } from "@/components/cx/listening/listening-nav";
import { NoBrand } from "@/components/cx/listening/no-brand";
import { UgcBoard } from "@/components/cx/listening/ugc-board";
import { Page, PageHeader } from "@/components/shell/page";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { consentMessage, listUgc, ugcCounts } from "@/lib/cx/listening/ugc";
import { num } from "@/lib/format";

export const metadata: Metadata = { title: "UGC board" };

export default async function UgcPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="UGC board" />;
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const filter = { consent: g("consent"), type: g("type"), sentiment: g("sentiment") };
  const [items, counts] = await Promise.all([listUgc(brand.id, filter), ugcCounts(brand.id)]);
  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX" }, { label: "Listening", href: `/cx/listening?brand=${brand.id}` }, { label: "UGC" }]}
        title="UGC board"
        subject={brand.name}
        description="Posts with photos and videos from your listening sources, and a tracker for permission to reuse them."
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
      />
      <ListeningNav current="/cx/listening/ugc" brandId={brand.id} />
      <MetricStrip className="mb-5">
        <Metric label="Media posts" value={num(counts.total)} sub={`${num(counts.images)} with images · ${num(counts.videos)} with video`} />
        <Metric label="Consent requested" value={num(counts.requested)} sub="awaiting an answer" />
        <Metric label="Granted" value={num(counts.granted)} />
        <Metric label="Denied / withdrawn" value={num(counts.denied + counts.withdrawn)} />
      </MetricStrip>
      {counts.total === 0 ? (
        <Card>
          <EmptyState icon={<ImageIcon className="h-5 w-5" />} title="No media posts yet" description="Mastodon, Bluesky, Reddit and YouTube mentions with images or videos appear here after the next fetch." />
        </Card>
      ) : (
        <UgcBoard brandId={brand.id} items={items.map((i) => ({ ...i, published_at: i.published_at ? new Date(i.published_at).toISOString() : null, requested_at: i.requested_at ? new Date(i.requested_at).toISOString() : null, responded_at: i.responded_at ? new Date(i.responded_at).toISOString() : null, body: i.body.slice(0, 500), defaultRequest: consentMessage(brand.name, i.author_handle) }))} filter={filter} />
      )}
    </Page>
  );
}
