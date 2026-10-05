import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { mediaLabel } from "@/lib/cx/ops/model";
import { reportContext } from "@/lib/cx/reports/data";
import { rangeLabel } from "@/lib/cx/reports/model";
import { oneClickPreview } from "@/lib/cx/reports/one-click";
import { NoBrand } from "@/components/cx/insights/common";
import { ReportEmpty, ReportFrame } from "@/components/cx/reports/frame";
import { OneClickReport } from "@/components/cx/reports/one-click";

export const metadata: Metadata = { title: "One-Click Report" };
type SP = Record<string, string | string[] | undefined>;

export default async function OneClickReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="One-Click Report" />;
  const ctx = await reportContext(brand, sp);
  const preview = await oneClickPreview(ctx);
  const f = ctx.filters;
  const filters: Record<string, string> = { from: f.range.from, to: f.range.to, basis: f.basis, interval: f.interval, ...f.scope };
  if (f.media.length) filters.media = f.media.join(",");
  const hasData = preview.conversations + preview.tickets > 0;

  return (
    <ReportFrame
      ctx={ctx}
      switcher={switcher}
      page="one-click"
      title="One-Click Report"
      description="Download Share of Voice, Sentiment Analysis or Ticketing as one Excel workbook for the selected period and scope."
      mediaOptions={preview.mediaOptions}
      filters={{ scope: true, media: true }}
    >
      {!hasData && <ReportEmpty brand={brand.id} what="A one-click report bundles every widget of a report (listening mentions and tickets) into one workbook." />}
      <OneClickReport
        brand={brand.id}
        filters={filters}
        summary={{
          period: rangeLabel(f.range),
          scope: ctx.scope.isDefault ? `All of ${brand.name}` : ctx.scope.label,
          media: f.media.length ? f.media.map(mediaLabel).join(", ") : "All",
          basis: f.basis === "created" ? "Created date" : "Publish date",
        }}
        counts={{ conversations: preview.conversations, tickets: preview.tickets }}
        downloadHref={`/cx/reports/download?brand=${encodeURIComponent(brand.id)}`}
        hasData={hasData}
      />
    </ReportFrame>
  );
}
