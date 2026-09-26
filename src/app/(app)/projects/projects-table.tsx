"use client";

import { BarChart3, Ellipsis, Globe, LayoutDashboard, Monitor, Settings2, Smartphone, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { database } from "@/lib/domain";
import { dateLabel } from "@/lib/format";
import type { ToolSummary } from "@/lib/projects/summary-types";
import { DomainAvatar } from "@/components/seo/badges";
import { ToolCell } from "@/components/dashboard/tool-widget";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Menu, MenuItem } from "@/components/ui/dialog";
import { DeleteProjectDialog } from "./delete-project-dialog";

export type ProjectRow = {
  id: string;
  name: string;
  domain: string;
  country: string;
  device: "desktop" | "mobile";
  location: string;
  competitors: number;
  created_at: string;
  summaries: ToolSummary[];
};

/** Numeric sort key for a widget: ready values first (parsed), then running, empty, error. */
function widgetSort(s: ToolSummary | undefined) {
  if (!s) return null;
  if (s.state === "ready") {
    const n = parseFloat(String(s.headline?.value ?? "").replace(/[^0-9.\-]/g, ""));
    const mult = /k$/i.test(String(s.headline?.value ?? "").trim()) ? 1e3 : /m$/i.test(String(s.headline?.value ?? "").trim()) ? 1e6 : 1;
    return Number.isFinite(n) ? n * mult : 0;
  }
  return s.state === "running" ? -1 : s.state === "empty" ? -2 : -3;
}

export function ProjectsTable({ rows, tools }: { rows: ProjectRow[]; tools: { index: number; label: string }[] }) {
  const [deleting, setDeleting] = useState<ProjectRow | null>(null);
  const columns = useMemo<Column<ProjectRow>[]>(
    () => [
      {
        key: "name",
        header: "Project",
        sortValue: (r) => r.name.toLowerCase(),
        csv: (r) => r.name,
        render: (r) => {
          const db = database(r.country);
          const DeviceIcon = r.device === "mobile" ? Smartphone : Monitor;
          return (
            <div className="flex min-w-[220px] items-center gap-2.5">
              <DomainAvatar domain={r.domain} size={26} />
              <div className="min-w-0">
                <Link href={`/projects/${r.id}`} className="block max-w-[240px] truncate font-medium text-text hover:text-link">
                  {r.name}
                </Link>
                <div className="flex items-center gap-1.5 text-[12px] text-text-3">
                  <span className="max-w-[140px] truncate">{r.domain}</span>
                  <span title={db.name}>
                    {db.flag} {db.code}
                  </span>
                  <DeviceIcon className="h-3 w-3" aria-label={r.device} />
                </div>
              </div>
            </div>
          );
        },
      },
      ...tools.map<Column<ProjectRow>>((t) => ({
        key: `tool-${t.index}`,
        header: t.label,
        align: "right",
        sortValue: (r) => widgetSort(r.summaries[t.index]),
        csv: (r) => {
          const s = r.summaries[t.index];
          return s?.state === "ready" ? (s.headline?.value ?? "ready") : (s?.state ?? "");
        },
        render: (r) => <ToolCell summary={r.summaries[t.index]} />,
      })),
      { key: "competitors", header: "Competitors", align: "right", render: (r) => (r.competitors ? r.competitors : <span className="text-text-3">–</span>) },
      { key: "created_at", header: "Created", align: "right", sortValue: (r) => r.created_at, csv: (r) => r.created_at.slice(0, 10), render: (r) => <span className="text-text-2 whitespace-nowrap">{dateLabel(r.created_at)}</span> },
      {
        key: "actions",
        header: "",
        sortable: false,
        noExport: true,
        align: "right",
        render: (r) => (
          <Menu
            align="right"
            trigger={() => (
              <Button size="icon" variant="ghost" aria-label={`Actions for ${r.name}`} className="h-7 w-7">
                <Ellipsis className="h-4 w-4" />
              </Button>
            )}
          >
            {(close) => (
              <>
                <MenuItem href={`/projects/${r.id}`} icon={<LayoutDashboard className="h-4 w-4 text-text-3" />}>
                  Project dashboard
                </MenuItem>
                <MenuItem href={`/projects/${r.id}?tab=settings`} icon={<Settings2 className="h-4 w-4 text-text-3" />}>
                  Settings
                </MenuItem>
                <MenuItem href={`/domain-overview?q=${encodeURIComponent(r.domain)}&db=${r.country}`} icon={<Globe className="h-4 w-4 text-text-3" />}>
                  Domain Overview
                </MenuItem>
                <MenuItem href={`/reports/new?template=project&project=${r.id}`} icon={<BarChart3 className="h-4 w-4 text-text-3" />}>
                  Create PDF report
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
                  Delete project
                </MenuItem>
              </>
            )}
          </Menu>
        ),
      },
    ],
    [tools],
  );
  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        defaultSort={{ key: "created_at", dir: "desc" }}
        searchable
        searchPlaceholder="Search projects"
        searchText={(r) => `${r.name} ${r.domain} ${r.location}`}
        exportName="projects"
        emptyText="No projects match your search."
        pageSize={25}
      />
      <DeleteProjectDialog project={deleting} open={!!deleting} onClose={() => setDeleting(null)} />
    </>
  );
}
