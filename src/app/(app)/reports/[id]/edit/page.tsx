import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { listProjects } from "@/lib/projects";
import { findReport, reportAvailability } from "@/lib/reports";
import { ReportBuilder } from "@/components/reports/report-builder";
import { Page, PageHeader } from "@/components/shell/page";

export const metadata: Metadata = { title: "Edit report" };

export default async function EditReportPage({ params }: PageProps<"/reports/[id]/edit">) {
  const user = await requirePageUser();
  const { id } = await params;
  const [report, projects] = await Promise.all([findReport(user.id, id), listProjects(user.id)]);
  if (!report) notFound();
  return (
    <Page>
      <PageHeader breadcrumbs={[{ label: "My Reports", href: "/reports" }, { label: report.title, href: `/reports/${report.id}` }, { label: "Edit" }]} title="Edit report" subject={report.title} />
      <ReportBuilder
        available={reportAvailability()} projects={projects.map((p) => ({ id: p.id, name: p.name, domain: p.domain, country: p.country, competitors: p.competitors }))} initial={report} />
    </Page>
  );
}
