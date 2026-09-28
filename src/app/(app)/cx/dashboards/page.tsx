import { LayoutGrid } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { listDashboards } from "@/lib/cx/insights/dashboards";
import { SOURCES } from "@/lib/cx/insights/widget-defs";
import { dateLabel } from "@/lib/format";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { BrandMeta, NoBrand, cxHref } from "@/components/cx/insights/common";
import { NewDashboardButton } from "@/components/cx/insights/new-dashboard";

export const metadata: Metadata = { title: "Dashboards" };

export default async function DashboardsPage({ searchParams }: PageProps<"/cx/dashboards">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Dashboards" />;
  const list = await listDashboards(brand.id, user.id);
  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX", href: cxHref("/cx", brand.id) }, { label: "Dashboards" }]}
        title="Dashboards"
        subject={brand.name}
        description="Build your own BI dashboards across tickets, messages, mentions, survey responses and quality reviews."
        meta={<BrandMeta switcher={switcher} current={brand.id} />}
        actions={<NewDashboardButton brand={brand.id} />}
      />
      {list.length === 0 ? (
        <Card>
          <EmptyState icon={<LayoutGrid className="h-5 w-5" />} title="No dashboards yet" description="Start from a template (support performance, voice of customer) or a blank canvas, then add and arrange widgets." action={<NewDashboardButton brand={brand.id} />} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((d) => {
            const sources = [...new Set(d.widgets.map((w) => SOURCES[w.source]?.label).filter(Boolean))];
            return (
              <Link key={d.id} href={cxHref(`/cx/dashboards/${d.id}`, brand.id)} className="rounded-lg border border-border bg-surface p-4 shadow-card hover:border-border-strong">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-semibold text-text">{d.name}</div>
                    <div className="mt-0.5 line-clamp-2 text-[12.5px] text-text-3">{d.description || "No description"}</div>
                  </div>
                  <Badge tone={d.shared ? "good" : "neutral"}>{d.shared ? "Shared" : "Private"}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {sources.length ? sources.map((s) => <Badge key={s}>{s}</Badge>) : <span className="text-[12px] text-text-3">No widgets</span>}
                </div>
                <div className="mt-3 text-[12px] text-text-3">
                  {d.widgets.length} widget{d.widgets.length === 1 ? "" : "s"} · updated {dateLabel(d.updated_at)}{d.creator ? ` · by ${d.creator}` : ""}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Page>
  );
}
