import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { fieldColumns, listFiles, listSchedules, listTemplates } from "@/lib/cx/insights/exports";
import { brandMailer } from "@/lib/cx/insights/mailer";
import { reportContext } from "@/lib/cx/reports/data";
import { NoBrand } from "@/components/cx/insights/common";
import { DownloadCentre } from "@/components/cx/insights/download-centre";
import { ReportFrame } from "@/components/cx/reports/frame";

export const metadata: Metadata = { title: "Download centre" };
type SP = Record<string, string | string[] | undefined>;
const ser = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export default async function DownloadCentrePage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Download centre" />;
  const [ctx, templates, schedules, files, fcols, mailer] = await Promise.all([
    reportContext(brand, sp),
    listTemplates(brand.id),
    listSchedules(brand.id),
    listFiles(brand.id),
    fieldColumns(brand.id),
    brandMailer(brand.id),
  ]);
  return (
    <ReportFrame
      ctx={ctx}
      switcher={switcher}
      page="download"
      title="Download centre"
      description="Export ticket and message data now, manage export templates, schedule emailed exports and re-download recent files."
      source="Source: stored tickets and messages"
      filters={{ date: false }}
    >
      <DownloadCentre brand={brand.id} templates={ser(templates)} schedules={ser(schedules)} files={ser(files)} fieldColumns={fcols} mailbox={!!mailer} />
    </ReportFrame>
  );
}
