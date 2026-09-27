"use client";

import { ArrowRightCircle, ThumbsDown, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { setProspectStateAction } from "@/app/(app)/link-building/actions";
import type { LbProspect, PipelineRow } from "@/lib/backlinks/types";
import { AsBadge, DomainAvatar, DomainLink, KeywordLink } from "@/components/seo/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Callout } from "@/components/ui/feedback";
import { Select } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { Stars, shortDate } from "./bits";
import { ExportButton, useCsvExport, ScrollSegmented } from "./table-tools";

export function useProspectMover(projectId: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const move = (domains: string[], state: "in_progress" | "rejected" | null, after?: () => void) =>
    start(async () => {
      const res = await setProspectStateAction(projectId, domains, state);
      if (!res.ok) setError(res.error);
      else {
        setError(null);
        after?.();
        router.refresh();
      }
    });
  return { move, pending, error };
}

type MinRating = "all" | "5" | "4" | "3";

export function ProspectsTable({ projectId, prospects, rejected, competitorCount, db, domain }: { projectId: string; prospects: LbProspect[]; rejected: PipelineRow[]; competitorCount: number; db: string; domain: string }) {
  const [minRating, setMinRating] = useState<MinRating>("all");
  const [source, setSource] = useState("");
  const [view, setView] = useState<"new" | "rejected">("new");
  const { move, pending, error } = useProspectMover(projectId);
  const filtered = useMemo(
    () =>
      prospects.filter((p) => {
        if (minRating !== "all" && p.rating < Number(minRating)) return false;
        if (source === "competitors" && !p.competitors.length) return false;
        if (source === "keywords" && !p.keywords.length) return false;
        return true;
      }),
    [prospects, minRating, source],
  );
  const columns: Column<LbProspect>[] = [
    {
      key: "domain",
      header: "Prospect",
      render: (p) => (
        <div className="max-w-[420px] min-w-[230px]">
          <DomainLink domain={p.domain} db={db} />
          <div className="mt-0.5 line-clamp-2 text-[11.5px] text-text-3" title={p.reason}>
            {p.reason}
          </div>
        </div>
      ),
    },
    { key: "rating", header: "Rating", sortValue: (p) => p.score, info: "1–5 stars from Authority Score, topical relevance and how many of your competitors the site links to.", render: (p) => <Stars value={p.rating} reason={p.reason} /> },
    { key: "authorityScore", header: "AS", align: "right", render: (p) => (p.authorityScore ? <AsBadge score={p.authorityScore} /> : <span className="text-text-3">n/a</span>) },
    {
      key: "competitors",
      header: "Links to competitors",
      sortValue: (p) => p.competitors.length,
      render: (p) =>
        p.competitors.length ? (
          <Tooltip content={p.competitors.join(", ")}>
            <span className="inline-flex items-center gap-1.5">
              <span className="flex -space-x-1">
                {p.competitors.slice(0, 4).map((c) => (
                  <span key={c} className="rounded ring-2 ring-surface">
                    <DomainAvatar domain={c} size={16} />
                  </span>
                ))}
              </span>
              <span className="tabular text-[12.5px] text-text-2">
                {p.competitors.length}/{competitorCount}
              </span>
            </span>
          </Tooltip>
        ) : (
          <span className="text-text-3">–</span>
        ),
    },
    {
      key: "keywords",
      header: "Ranks for",
      sortValue: (p) => (p.keywords.length ? 101 - p.keywords[0].position : 0),
      render: (p) =>
        p.keywords.length ? (
          <span className="inline-flex max-w-[240px] items-center gap-1.5">
            <Badge tone="info" className="tabular">
              #{p.keywords[0].position}
            </Badge>
            <KeywordLink keyword={p.keywords[0].keyword} db={db} className="truncate text-[12.5px]" />
            {p.keywords.length > 1 && <span className="text-[11.5px] text-text-3">+{p.keywords.length - 1}</span>}
          </span>
        ) : (
          <span className="text-text-3">–</span>
        ),
    },
    { key: "category", header: "Category", render: (p) => <span className="text-[12.5px] whitespace-nowrap text-text-2">{p.category || "n/a"}</span> },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: (p) => (
        <span className="inline-flex items-center gap-1">
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => move([p.domain], "in_progress")}>
            <ArrowRightCircle className="h-3.5 w-3.5" /> To In progress
          </Button>
          <Tooltip content="Reject: hide this prospect">
            <button type="button" disabled={pending} onClick={() => move([p.domain], "rejected")} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-3 hover:bg-surface-3 hover:text-text" aria-label={`Reject ${p.domain}`}>
              <ThumbsDown className="h-4 w-4" />
            </button>
          </Tooltip>
        </span>
      ),
    },
  ];
  const rejectedColumns: Column<PipelineRow>[] = [
    { key: "domain", header: "Prospect", render: (r) => <DomainLink domain={r.domain} db={db} /> },
    { key: "rating", header: "Rating", render: (r) => (r.rating ? <Stars value={r.rating} reason={r.reason} /> : <span className="text-text-3">n/a</span>) },
    { key: "authorityScore", header: "AS", align: "right", render: (r) => (r.authorityScore ? <AsBadge score={r.authorityScore} /> : <span className="text-text-3">n/a</span>) },
    { key: "updatedAt", header: "Rejected", align: "right", render: (r) => <span className="text-text-2">{shortDate(r.updatedAt)}</span> },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: (r) => (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => move([r.domain], null)}>
          <Undo2 className="h-3.5 w-3.5" /> Restore
        </Button>
      ),
    },
  ];
  const { onRowsChange, exportCsv } = useCsvExport<LbProspect>(`${domain}-link-prospects`, ["Domain", "Rating", "Authority Score", "Category", "Competitors linking", "Best keyword", "Best position", "Reason"], (p) => [p.domain, p.rating, p.authorityScore, p.category, p.competitors.join(" "), p.keywords[0]?.keyword ?? "", p.keywords[0]?.position ?? "", p.reason]);

  return (
    <div>
      {error && (
        <Callout tone="critical" className="mx-4 mb-3">
          {error}
        </Callout>
      )}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        <ScrollSegmented<"new" | "rejected">
          value={view}
          onChange={setView}
          options={[
            { value: "new", label: `Prospects · ${prospects.length}` },
            { value: "rejected", label: `Rejected · ${rejected.length}` },
          ]}
        />
        {view === "new" && (
          <>
            <ScrollSegmented<MinRating>
              value={minRating}
              onChange={setMinRating}
              options={[
                { value: "all", label: "All ratings" },
                { value: "5", label: "★★★★★" },
                { value: "4", label: "4★+" },
                { value: "3", label: "3★+" },
              ]}
            />
            <Select value={source} onChange={(e) => setSource(e.target.value)} className="h-8 w-auto" aria-label="Source">
              <option value="">All sources</option>
              <option value="competitors">Links to competitors</option>
              <option value="keywords">Ranks for your keywords</option>
            </Select>
          </>
        )}
      </div>
      {view === "new" ? (
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(p) => p.domain}
          defaultSort={{ key: "rating", dir: "desc" }}
          searchable
          searchPlaceholder="Filter by domain"
          searchText={(p) => `${p.domain} ${p.category}`}
          selectable
          selectionActions={(sel, clear) => (
            <>
              <Button size="sm" variant="primary" disabled={pending} onClick={() => move(sel.map((p) => p.domain), "in_progress", clear)}>
                <ArrowRightCircle className="h-3.5 w-3.5" /> To In progress
              </Button>
              <Button size="sm" disabled={pending} onClick={() => move(sel.map((p) => p.domain), "rejected", clear)}>
                <ThumbsDown className="h-3.5 w-3.5" /> Reject
              </Button>
            </>
          )}
          onRowsChange={onRowsChange}
          toolbar={
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <span className="text-[12.5px] text-text-3">{filtered.length.toLocaleString()} prospects</span>
              <ExportButton onClick={exportCsv} className="ml-auto" />
            </div>
          }
          emptyText="No prospects match these filters."
        />
      ) : (
        <DataTable rows={rejected} columns={rejectedColumns} rowKey={(r) => r.domain} defaultSort={{ key: "updatedAt", dir: "desc" }} emptyText="You haven't rejected any prospects." />
      )}
    </div>
  );
}
