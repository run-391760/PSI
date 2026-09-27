import { BarChart3, FolderKanban, Globe, Link2, Plus, Swords } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { listReports, reportAvailability } from "@/lib/reports";
import { TEMPLATES, templateAvailable, type TemplateId } from "@/lib/reports/templates";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader } from "@/components/shell/page";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { ReportsList } from "./reports-list";

export const metadata: Metadata = { title: "My Reports" };

const ICONS: Record<TemplateId, typeof Globe> = { domain: Globe, project: FolderKanban, backlinks: Link2, comparison: Swords };

export default async function ReportsPage() {
  const user = await requirePageUser();
  const reports = await listReports(user.id);
  const available = reportAvailability();
  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "Monitoring & reports" }, { label: "My Reports" }]}
        title="My Reports"
        description="Build branded, printable SEO reports from your real data sources and export them to PDF."
        actions={
          <ButtonLink href="/reports/new" variant="primary">
            <span className="inline-flex items-center gap-1.5 text-white"><Plus className="h-4 w-4" /> New report</span>
          </ButtonLink>
        }
      />
      <h2 className="mb-2.5 text-[14px] font-semibold text-text">Start from a template</h2>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {TEMPLATES.map((t) => {
          const Icon = ICONS[t.id];
          return (
            <Link key={t.id} href={`/reports/new?template=${t.id}`} className="group flex flex-col rounded-lg border border-border bg-surface p-4 shadow-card transition-colors hover:border-brand/40">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-soft text-brand-ink">
                <Icon className="h-4.5 w-4.5" />
              </span>
              <span className="mt-3 text-[14px] font-semibold text-text group-hover:text-link">{t.name}</span>
              <span className="mt-1 flex-1 text-[12.5px] text-text-3">{t.description}</span>
              <span className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px] text-text-3">
                {t.subject === "project" ? "For a project · Search Console, Site Audit, Position Tracking" : "For any domain"}
                {!templateAvailable(t, available) && <Badge tone="warning">Needs DataForSEO</Badge>}
              </span>
            </Link>
          );
        })}
      </div>
      <Card className={reports.length ? "pt-0" : ""}>
        {reports.length ? (
          <>
            <CardHeader title="Saved reports" description={`${reports.length} report${reports.length === 1 ? "" : "s"}`} />
            <ReportsList reports={reports} />
          </>
        ) : (
          <EmptyState
            icon={<BarChart3 className="h-5 w-5" />}
            title="No saved reports yet"
            description="Pick a template above, choose the sections you need and add your branding. Reports always render with fresh data and export to PDF."
            action={
              <ButtonLink href="/reports/new" variant="primary">
                <span className="inline-flex items-center gap-1.5 text-white"><Plus className="h-4 w-4" /> Create your first report</span>
              </ButtonLink>
            }
          />
        )}
      </Card>
    </Page>
  );
}
