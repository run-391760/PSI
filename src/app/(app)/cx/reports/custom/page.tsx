import { FileSpreadsheet, LayoutGrid } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { listDashboards } from "@/lib/cx/insights/dashboards";
import { listTemplates } from "@/lib/cx/insights/exports";
import { SOURCES } from "@/lib/cx/insights/widget-defs";
import { reportContext } from "@/lib/cx/reports/data";
import { dateLabel } from "@/lib/format";
import { NoBrand } from "@/components/cx/insights/common";
import { NewDashboardButton } from "@/components/cx/insights/new-dashboard";
import { ReportFrame } from "@/components/cx/reports/frame";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { MiniTable } from "@/components/ui/mini-table";

export const metadata: Metadata = { title: "Custom Reports" };
type SP = Record<string, string | string[] | undefined>;

export default async function CustomReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Custom Reports" />;
  const [ctx, list, templates] = await Promise.all([reportContext(brand, sp), listDashboards(brand.id, user.id), listTemplates(brand.id)]);
  const q = `?brand=${encodeURIComponent(brand.id)}`;

  return (
    <ReportFrame
      ctx={ctx}
      switcher={switcher}
      page="custom"
      title="Custom Reports"
      description="Build your own reports from widgets over tickets, messages, mentions, surveys and quality reviews. Custom reports are saved as dashboards."
      source="Source: stored CX records"
      filters={{ date: false }}
      actions={<NewDashboardButton brand={brand.id} />}
    >
      <Card>
        <CardHeader title={`Your custom reports (${list.length})`} description="Shared reports and your private ones. Open a report to add widgets, filter it, share it or export it." />
        <CardBody className="pt-1">
          {list.length === 0 ? (
            <EmptyState
              icon={<LayoutGrid className="h-5 w-5" />}
              title="No custom reports yet"
              description="Start from a template (support performance, voice of customer) or a blank canvas, then add and arrange widgets."
              action={<NewDashboardButton brand={brand.id} />}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {list.map((d) => {
                const sources = [...new Set(d.widgets.map((w) => SOURCES[w.source]?.label).filter(Boolean))];
                return (
                  <Link key={d.id} href={`/cx/dashboards/${d.id}${q}`} className="block min-w-0 rounded-md border border-border bg-surface p-3 hover:border-border-strong hover:bg-surface-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-semibold text-text">{d.name}</div>
                        <div className="mt-0.5 line-clamp-2 text-[12.5px] text-text-3">{d.description || "No description"}</div>
                      </div>
                      <Badge tone={d.shared ? "good" : "neutral"}>{d.shared ? "Shared" : "Private"}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {sources.length ? sources.map((s) => <Badge key={s}>{s}</Badge>) : <span className="text-[12px] text-text-3">No widgets</span>}
                    </div>
                    <div className="mt-2 text-[12px] text-text-3">
                      {d.widgets.length} widget{d.widgets.length === 1 ? "" : "s"} · updated {dateLabel(d.updated_at)}
                      {d.creator ? ` · by ${d.creator}` : ""}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Export templates (${templates.length})`}
          description="Custom column sets for ticket and message exports. Create, edit and schedule them in the Download centre."
        />
        <CardBody className="pt-1">
          <MiniTable
            columns={[{ header: "Template" }, { header: "Data" }, { header: "Columns", align: "right" }, { header: "TAT hours", className: "hidden sm:table-cell" }]}
            rows={templates.map((t) => [
              <span key="n" className="flex min-w-0 items-center gap-1.5 font-medium text-text">
                <span className="truncate">{t.name}</span>
                {t.builtin && <Badge>Built-in</Badge>}
              </span>,
              t.source === "messages" ? "Messages" : "Tickets",
              t.columns.length,
              t.basis === "business" ? "Business" : "Calendar",
            ])}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <ButtonLink size="sm" variant="primary" href={`/cx/reports/download${q}`}>
              Open Download centre
            </ButtonLink>
            <ButtonLink size="sm" href={`/cx/reports/one-click${q}`}>
              <FileSpreadsheet className="h-3.5 w-3.5" /> One-click report
            </ButtonLink>
          </div>
        </CardBody>
      </Card>
    </ReportFrame>
  );
}
