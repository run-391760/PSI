"use client";

import { Copy, Ellipsis, Eye, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { database } from "@/lib/domain";
import { dateLabel, timeAgo } from "@/lib/format";
import { accentColor, type ReportRecord, templateById } from "@/lib/reports/templates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Menu, MenuItem } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { deleteReportAction, duplicateReportAction } from "./actions";

/** Saved reports with open / edit / duplicate / delete. */
export function ReportsList({ reports }: { reports: ReportRecord[] }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<ReportRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const duplicate = (r: ReportRecord) =>
    start(async () => {
      setError(null);
      const res = await duplicateReportAction(r.id);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  const remove = () =>
    deleting &&
    start(async () => {
      setDeleteError(null);
      const res = await deleteReportAction(deleting.id);
      if (!res.ok) return setDeleteError(res.error);
      setDeleting(null);
      router.refresh();
    });

  const columns = useMemo<Column<ReportRecord>[]>(
    () => [
      {
        key: "title",
        header: "Report",
        sortValue: (r) => r.title.toLowerCase(),
        csv: (r) => r.title,
        render: (r) => (
          <div className="flex min-w-[240px] items-center gap-2.5">
            <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: accentColor(r.branding.accent) }} aria-hidden />
            <div className="min-w-0">
              <Link href={`/reports/${r.id}`} className="block max-w-[360px] truncate font-medium text-text hover:text-link">
                {r.title}
              </Link>
              <div className="text-[12px] text-text-3">
                {r.sections.length} sections{r.branding.preparedFor ? ` · for ${r.branding.preparedFor}` : ""}
              </div>
            </div>
          </div>
        ),
      },
      { key: "template", header: "Template", sortValue: (r) => r.template, render: (r) => <Badge tone="brand">{templateById(r.template)?.short ?? r.template}</Badge> },
      {
        key: "subject",
        header: "Subject",
        sortValue: (r) => r.subject,
        csv: (r) => r.subject,
        render: (r) => (
          <div className="min-w-0">
            <div className="max-w-[220px] truncate text-text">{r.template === "project" ? (r.project_name ?? r.subject) : r.subject}</div>
            <div className="text-[12px] text-text-3">
              {database(r.db).flag} {r.db}
              {r.template === "comparison" && r.options.competitors?.length ? ` · vs ${r.options.competitors.length}` : ""}
            </div>
          </div>
        ),
      },
      {
        key: "updated_at",
        header: "Updated",
        align: "right",
        sortValue: (r) => r.updated_at,
        render: (r) => (
          <span className="whitespace-nowrap text-text-2" title={dateLabel(r.updated_at)} suppressHydrationWarning>
            {timeAgo(r.updated_at)}
          </span>
        ),
      },
      {
        key: "actions",
        header: "",
        sortable: false,
        noExport: true,
        align: "right",
        render: (r) => (
          <div className="flex items-center justify-end gap-1">
            <Link href={`/reports/${r.id}`} className="hidden rounded-md px-2 py-1 text-[12.5px] text-link hover:bg-surface-3 sm:inline-block">
              Open
            </Link>
            <Menu
              align="right"
              trigger={() => (
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Actions for ${r.title}`}>
                  <Ellipsis className="h-4 w-4" />
                </Button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem href={`/reports/${r.id}`} icon={<Eye className="h-4 w-4 text-text-3" />}>
                    Open & export PDF
                  </MenuItem>
                  <MenuItem href={`/reports/${r.id}/edit`} icon={<Pencil className="h-4 w-4 text-text-3" />}>
                    Edit
                  </MenuItem>
                  <MenuItem
                    icon={<Copy className="h-4 w-4 text-text-3" />}
                    onClick={() => {
                      close();
                      duplicate(r);
                    }}
                  >
                    Duplicate
                  </MenuItem>
                  <div className="my-1 border-t border-border" />
                  <MenuItem
                    danger
                    icon={<Trash2 className="h-4 w-4" />}
                    onClick={() => {
                      close();
                      setDeleting(r);
                    }}
                  >
                    Delete
                  </MenuItem>
                </>
              )}
            </Menu>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <>
      {error && (
        <div className="px-4 pb-3">
          <Callout tone="critical">{error}</Callout>
        </div>
      )}
      <DataTable rows={reports} columns={columns} rowKey={(r) => r.id} defaultSort={{ key: "updated_at", dir: "desc" }} searchable searchPlaceholder="Search reports" searchText={(r) => `${r.title} ${r.subject} ${r.project_name ?? ""} ${r.branding.preparedFor}`} exportName="reports" emptyText="No reports match your search." />
      <ConfirmDialog
        open={!!deleting}
        onCancel={() => {
          setDeleting(null);
          setDeleteError(null);
        }}
        onConfirm={remove}
        title="Delete report?"
        description={
          <>
            <span className="font-medium text-text">{deleting?.title}</span>
            <br />
            The saved report configuration will be removed. Exported PDFs you downloaded are not affected.
          </>
        }
        confirmLabel="Delete report"
        busy={pending}
        error={deleteError}
      />
    </>
  );
}
