import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth";
import { database } from "@/lib/domain";
import { listProjects } from "@/lib/projects";
import { reportAvailability } from "@/lib/reports";
import { ReportBuilder } from "@/components/reports/report-builder";
import { Page, PageHeader } from "@/components/shell/page";

export const metadata: Metadata = { title: "New report" };

export default async function NewReportPage({ searchParams }: PageProps<"/reports/new">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const projects = await listProjects(user.id);
  return (
    <Page>
      <PageHeader breadcrumbs={[{ label: "My Reports", href: "/reports" }, { label: "New report" }]} title="Create a report" description="Choose a template, the domain or project, the sections to include and your branding." />
      <ReportBuilder
        available={reportAvailability()}
        projects={projects.map((p) => ({ id: p.id, name: p.name, domain: p.domain, country: p.country, competitors: p.competitors }))}
        defaults={{ template: str(sp.template), project: str(sp.project), domain: str(sp.q), db: str(sp.db) ? database(str(sp.db)).code : undefined }}
      />
    </Page>
  );
}
