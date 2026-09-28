import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { Calendar, CampaignsCard } from "@/components/cx/publishing/calendar";
import { NoBrand, PubNav } from "@/components/cx/publishing/shared";
import { Page, PageHeader } from "@/components/shell/page";
import { ButtonLink } from "@/components/ui/button";
import { requirePageUser } from "@/lib/auth";
import { listCampaigns, listPosts, pubContext, statusCounts } from "@/lib/cx/publishing/data";

export const metadata: Metadata = { title: "Content calendar" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher, access } = await pubContext(user.id, sp);
  if (!brand || !access) return <NoBrand title="Content calendar" redirect="/cx/publishing/calendar" />;
  const [posts, campaigns, counts] = await Promise.all([listPosts(brand.id), listCampaigns(brand.id), statusCounts(brand.id)]);
  return (
    <Page wide>
      <PageHeader
        breadcrumbs={[{ label: "CX" }, { label: "Publishing", href: `/cx/publishing?brand=${brand.id}` }, { label: "Calendar" }]}
        title="Content calendar"
        subject={brand.name}
        description="Planned, scheduled and published posts by day. Drag to reschedule; filter by channel or campaign."
        actions={
          <>
            <BrandSwitcher brands={switcher} current={brand.id} />
            {access.canAuthor && (
              <ButtonLink href={`/cx/publishing/new?brand=${brand.id}`} variant="primary">
                <Plus className="h-4 w-4" /> New post
              </ButtonLink>
            )}
          </>
        }
      />
      <PubNav brandId={brand.id} pending={counts.pending} />
      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        <Calendar
          brandId={brand.id}
          canAuthor={access.canAuthor}
          campaigns={campaigns}
          posts={posts.map((p) => {
            const at = p.published_at ?? p.scheduled_at;
            return { id: p.id, title: p.title || p.body.replaceAll("{link}", "").slice(0, 80) || "Untitled post", status: p.status, channels: p.channels, campaign_id: p.campaign_id, at: at ? new Date(at).toISOString() : null };
          })}
        />
        <div className="min-w-0">
          <CampaignsCard brandId={brand.id} campaigns={campaigns} canAuthor={access.canAuthor} />
        </div>
      </div>
    </Page>
  );
}
