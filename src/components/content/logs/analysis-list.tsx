"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteAnalysesAction } from "@/app/(app)/log-file-analyzer/actions";
import { compact, dateLabel, timeAgo } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";

export type AnalysisListRow = { id: string; name: string; origin: "upload" | "sample"; size: number; lines: number; parsed: number; botHits: number; from: string | null; to: string | null; created: string };

export function AnalysisList({ rows }: { rows: AnalysisListRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<AnalysisListRow[] | null>(null);
  const columns: Column<AnalysisListRow>[] = [
    {
      key: "name",
      header: "Log",
      render: (r) => (
        <span className="flex min-w-[200px] items-center gap-2">
          <Link href={`/log-file-analyzer/${r.id}`} className="max-w-[340px] truncate font-medium text-link hover:underline">
            {r.name}
          </Link>
          {r.origin === "sample" && <Badge tone="warning">Demo</Badge>}
        </span>
      ),
    },
    { key: "period", header: "Period", sortValue: (r) => r.from ?? "", render: (r) => (r.from ? <span className="whitespace-nowrap text-text-2">{r.from === r.to ? dateLabel(r.from) : `${dateLabel(r.from)} – ${dateLabel(r.to!)}`}</span> : "n/a"), csv: (r) => `${r.from} – ${r.to}` },
    { key: "lines", header: "Lines", align: "right", render: (r) => compact(r.lines) },
    { key: "botHits", header: "Bot hits", align: "right", render: (r) => compact(r.botHits) },
    { key: "size", header: "Size", align: "right", render: (r) => (r.size > 1024 * 1024 ? `${(r.size / 1024 / 1024).toFixed(1)} MB` : `${Math.round(r.size / 1024)} KB`) },
    { key: "created", header: "Analyzed", align: "right", render: (r) => <span className="text-text-2">{timeAgo(r.created)}</span> },
  ];
  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        selectable
        defaultSort={{ key: "created", dir: "desc" }}
        pageSize={10}
        selectionActions={(sel, clear) => (
          <Button size="sm" variant="danger" onClick={() => (setConfirm(sel), clear())}>
            <Trash2 className="h-3.5 w-3.5" /> Delete {sel.length}
          </Button>
        )}
      />
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={`Delete ${confirm?.length ?? 0} analysis${(confirm?.length ?? 0) === 1 ? "" : "es"}?`}
        description="Only the stored aggregates are deleted; your original log files are never kept."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() =>
                start(async () => {
                  if (confirm) await deleteAnalysesAction(confirm.map((c) => c.id));
                  setConfirm(null);
                  router.refresh();
                })
              }
            >
              Delete
            </Button>
          </>
        }
      >
        <ul className="space-y-1 text-[13px] text-text-2">
          {confirm?.map((c) => (
            <li key={c.id} className="truncate">
              {c.name}
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
