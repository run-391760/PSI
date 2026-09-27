"use client";

import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createTagAction, deleteTagAction, renameTagAction } from "@/app/(app)/position-tracking/actions";
import { compact, num, pct } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Callout } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Delta } from "./ui";

export type TagRow = {
  id: string;
  name: string;
  keywords: number;
  visibility: number | null;
  visibilityDelta: number | null;
  avgPosition: number | null;
  traffic: number | null;
  top3: number;
  top10: number;
};

export function TagsManager({ rows, projectId, base, trafficLabel = "Est. traffic" }: { rows: TagRow[]; projectId: string; base: string; trafficLabel?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "Something went wrong.");
      after?.();
      router.refresh();
    });

  return (
    <>
      <form
        className="flex flex-wrap items-center gap-2 px-4 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) run(() => createTagAction(projectId, name), () => setName(""));
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New tag name" maxLength={40} className="h-8 w-56" aria-label="New tag name" />
        <Button type="submit" size="sm" variant="primary" disabled={!name.trim()} loading={pending && !editing}>
          <Plus className="h-3.5 w-3.5" /> Create tag
        </Button>
        <span className="text-[12px] text-text-3">Assign tags from the Overview table (select keywords → Tags) or in a keyword's details.</span>
      </form>
      {error && (
        <Callout tone="critical" className="mx-4 mb-3">
          {error}
        </Callout>
      )}
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        defaultSort={{ key: "keywords", dir: "desc" }}
        exportName="tags"
        emptyText="No tags yet. Tags group keywords (e.g. brand, product, blog) so you can filter every report by them."
        columns={[
          {
            key: "name",
            header: "Tag",
            sortValue: (r) => r.name.toLowerCase(),
            render: (r) =>
              editing?.id === r.id ? (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(() => renameTagAction(projectId, r.id, editing.name), () => setEditing(null));
                  }}
                >
                  <Input value={editing.name} onChange={(e) => setEditing({ id: r.id, name: e.target.value })} maxLength={40} className="h-7 w-44" autoFocus aria-label="Tag name" />
                  <Button type="submit" size="icon" variant="ghost" className="h-7 w-7" aria-label="Save">
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Cancel" onClick={() => setEditing(null)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </form>
              ) : (
                <Link href={`${base}&tab=overview&tags=${r.id}`} className="font-medium text-link hover:underline" title="Show this tag's keywords">
                  {r.name}
                </Link>
              ),
          },
          { key: "keywords", header: "Keywords", align: "right" },
          { key: "visibility", header: "Visibility", align: "right", render: (r) => (r.visibility == null ? <span className="text-text-3">n/a</span> : pct(r.visibility, 2)), csv: (r) => r.visibility?.toFixed(2) },
          { key: "visibilityDelta", header: "Change", align: "right", render: (r) => <Delta value={r.visibilityDelta} digits={2} />, csv: (r) => r.visibilityDelta?.toFixed(2) },
          { key: "avgPosition", header: "Avg. position", align: "right", render: (r) => (r.avgPosition == null ? <span className="text-text-3">n/a</span> : num(r.avgPosition, 1)), csv: (r) => r.avgPosition?.toFixed(1) },
          { key: "traffic", header: trafficLabel, align: "right", render: (r) => (r.traffic == null ? <span className="text-text-3">n/a</span> : compact(r.traffic)) },
          { key: "top3", header: "Top 3", align: "right" },
          { key: "top10", header: "Top 10", align: "right" },
          {
            key: "actions",
            header: "",
            sortable: false,
            noExport: true,
            align: "right",
            render: (r) => (
              <span className="inline-flex gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Rename ${r.name}`} title="Rename" onClick={() => setEditing({ id: r.id, name: r.name })}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-critical-ink"
                  aria-label={`Delete ${r.name}`}
                  title="Delete tag (keywords stay tracked)"
                  onClick={() => confirm(`Delete the tag “${r.name}”? Keywords stay tracked; alert rules scoped to it apply to all keywords.`) && run(() => deleteTagAction(projectId, r.id))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </span>
            ),
          },
        ]}
      />
    </>
  );
}
