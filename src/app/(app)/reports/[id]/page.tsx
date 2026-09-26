import { Pencil } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentUser, requirePageUser } from "@/lib/auth";
import { timeAgo } from "@/lib/format";
import { findReport } from "@/lib/reports";
import { loadReportData } from "@/lib/reports/data";
import { templateById } from "@/lib/reports/templates";
import { REPORT_PRINT_CSS, ReportDocument } from "@/components/reports/report-document";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { PrintButton } from "@/components/ui/print-button";
import { DuplicateReportButton } from "./report-actions";

export async function generateMetadata({ params }: PageProps<"/reports/[id]">): Promise<Metadata> {
  const user = await currentUser();
  const { id } = await params;
  const report = user ? await findReport(user.id, id) : null;
  return { title: report?.title ?? "Report" };
}

export default async function ReportPage({ params }: PageProps<"/reports/[id]">) {
  const user = await requirePageUser();
  const { id } = await params;
  const report = await findReport(user.id, id);
  if (!report) notFound();
  const data = await loadReportData(user.id, report);
  return (
    <Page className="report-screen-pad">
      <style>{REPORT_PRINT_CSS}</style>
      <div className="no-print">
        <PageHeader
          breadcrumbs={[{ label: "My Reports", href: "/reports" }, { label: report.title }]}
          title={report.title}
          meta={
            <>
              <Badge tone="brand">{templateById(report.template)?.name ?? report.template}</Badge>
              <span className="text-[12px] text-text-3">
                {report.sections.length} sections · updated {timeAgo(report.updated_at)}
              </span>
            </>
          }
          actions={
            <>
              <ButtonLink href={`/reports/${report.id}/edit`}>
                <Pencil className="h-4 w-4" /> Edit
              </ButtonLink>
              <DuplicateReportButton id={report.id} />
              <PrintButton />
            </>
          }
        />
        <p className="-mt-2 mb-4 text-[12.5px] text-text-3">The report renders with current data every time you open it. Use Export PDF and choose “Save as PDF” (A4) in the print dialog.</p>
      </div>
      <ReportDocument report={report} data={data} />
    </Page>
  );
}
