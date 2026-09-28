import type { Metadata } from "next";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { AssetLibrary } from "@/components/cx/publishing/assets";
import { NoBrand, PubNav } from "@/components/cx/publishing/shared";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { requirePageUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { listAssets, pubContext, statusCounts } from "@/lib/cx/publishing/data";

export const metadata: Metadata = { title: "Asset library" };

export default async function AssetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher, access } = await pubContext(user.id, sp);
  if (!brand || !access) return <NoBrand title="Asset library" redirect="/cx/publishing/assets" />;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const kind = str("kind") === "image" || str("kind") === "video" ? str("kind") : undefined;
  const [assets, all, usage, counts] = await Promise.all([
    listAssets(brand.id, { q: str("q"), tag: str("tag"), kind }),
    listAssets(brand.id),
    query<{ id: string; n: number }>("SELECT m.id, count(*)::int n FROM cx_pub_posts p, jsonb_array_elements_text(p.media) AS m(id) WHERE p.project_id=$1 GROUP BY m.id", [brand.id]),
    statusCounts(brand.id),
  ]);
  const tags = [...new Set(all.flatMap((a) => a.tags))].sort();
  const bytes = all.reduce((s, a) => s + Number(a.size), 0);
  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX" }, { label: "Publishing", href: `/cx/publishing?brand=${brand.id}` }, { label: "Assets" }]}
        title="Asset library"
        subject={brand.name}
        description="Images and videos for your posts, stored on this server. Tag them to find them quickly."
        meta={
          <>
            <Badge>{all.length} files</Badge>
            <Badge>{(bytes / 1_048_576).toFixed(1)} MB</Badge>
          </>
        }
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
      />
      <PubNav brandId={brand.id} pending={counts.pending} />
      <AssetLibrary
        brandId={brand.id}
        canAuthor={access.canAuthor}
        tags={tags}
        filtered={!!(str("q") || str("tag") || kind)}
        assets={assets.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, size: Number(a.size), tags: a.tags, created_at: new Date(a.created_at).toISOString(), used: usage.find((u) => u.id === a.id)?.n ?? 0 }))}
      />
    </Page>
  );
}
