"use client";

import { Check, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addCompetitorAction } from "@/app/(app)/position-tracking/actions";
import { compact, num, pct } from "@/lib/format";
import { DomainLink } from "@/components/seo/badges";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Callout } from "@/components/ui/feedback";
import { Delta, domainColor } from "./ui";

export type CompetitorRow = {
  domain: string;
  index: number;
  own: boolean;
  visibility: number;
  visibilityDelta: number | null;
  sov: number | null;
  sovDelta: number | null;
  traffic: number;
  avgPosition: number | null;
  avgPositionDelta: number | null;
  top3: number;
  top10: number;
  ranked: number;
};

export function CompetitorsTable({ rows, db, exportName }: { rows: CompetitorRow[]; db: string; exportName: string }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.domain}
      defaultSort={{ key: "visibility", dir: "desc" }}
      exportName={exportName}
      rowClassName={(r) => (r.own ? "bg-brand-soft/30" : undefined)}
      columns={[
        {
          key: "domain",
          header: "Domain",
          sortValue: (r) => r.domain,
          render: (r) => (
            <span className="flex min-w-[160px] items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: domainColor(r.index) }} aria-hidden />
              <DomainLink domain={r.domain} db={db} avatar={false} className={r.own ? "font-semibold" : undefined} />
              {r.own && <span className="text-[11px] text-text-3">you</span>}
            </span>
          ),
        },
        { key: "visibility", header: "Visibility", align: "right", render: (r) => pct(r.visibility, 2), csv: (r) => r.visibility.toFixed(2) },
        { key: "visibilityDelta", header: "Change", align: "right", render: (r) => <Delta value={r.visibilityDelta} digits={2} />, csv: (r) => r.visibilityDelta?.toFixed(2) },
        { key: "sov", header: "Share of voice", align: "right", info: "Σ(volume × CTR) ÷ total search volume of tracked keywords.", render: (r) => (r.sov == null ? <span className="text-text-3">n/a</span> : pct(r.sov, 2)), csv: (r) => r.sov?.toFixed(2) },
        { key: "sovDelta", header: "SoV change", align: "right", render: (r) => <Delta value={r.sovDelta} digits={2} />, csv: (r) => r.sovDelta?.toFixed(2) },
        { key: "traffic", header: "Est. traffic", align: "right", render: (r) => compact(r.traffic), csv: (r) => Math.round(r.traffic) },
        { key: "avgPosition", header: "Avg. position", align: "right", render: (r) => (r.avgPosition == null ? "n/a" : num(r.avgPosition, 1)), csv: (r) => r.avgPosition?.toFixed(1) },
        { key: "avgPositionDelta", header: "Pos. change", align: "right", render: (r) => <Delta value={r.avgPositionDelta} />, csv: (r) => r.avgPositionDelta?.toFixed(1) },
        { key: "top3", header: "Top 3", align: "right" },
        { key: "top10", header: "Top 10", align: "right" },
        { key: "ranked", header: "Top 100", align: "right" },
      ]}
    />
  );
}

export type DiscoveredRow = { domain: string; tracked: boolean; keywords: number; avgPosition: number; visibility: number; traffic: number; top3: number; top10: number };

export function DiscoveredTable({ rows, projectId, db, canAdd, exportName }: { rows: DiscoveredRow[]; projectId: string; db: string; canAdd: boolean; exportName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error && (
        <Callout tone="critical" className="mx-4 mb-3">
          {error}
        </Callout>
      )}
      <DataTable
        rows={rows}
        rowKey={(r) => r.domain}
        defaultSort={{ key: "visibility", dir: "desc" }}
        exportName={exportName}
        searchable
        searchPlaceholder="Filter domains"
        searchText={(r) => r.domain}
        pageSize={10}
        columns={[
          { key: "domain", header: "Domain", sortValue: (r) => r.domain, render: (r) => <DomainLink domain={r.domain} db={db} className="max-w-[220px]" /> },
          { key: "keywords", header: "Keywords in top 20", align: "right" },
          { key: "visibility", header: "Visibility", align: "right", render: (r) => pct(r.visibility, 2), csv: (r) => r.visibility.toFixed(2) },
          { key: "avgPosition", header: "Avg. position", align: "right", render: (r) => num(r.avgPosition, 1), csv: (r) => r.avgPosition.toFixed(1) },
          { key: "traffic", header: "Est. traffic", align: "right", render: (r) => compact(r.traffic), csv: (r) => Math.round(r.traffic) },
          { key: "top3", header: "Top 3", align: "right" },
          { key: "top10", header: "Top 10", align: "right" },
          {
            key: "action",
            header: "",
            sortable: false,
            noExport: true,
            align: "right",
            render: (r) =>
              r.tracked ? (
                <span className="inline-flex items-center gap-1 text-[12px] text-text-3">
                  <Check className="h-3.5 w-3.5" /> Tracked
                </span>
              ) : (
                <Button
                  size="sm"
                  disabled={!canAdd || pending}
                  loading={busy === r.domain}
                  title={canAdd ? "Track this domain as a competitor" : "You already track the maximum of 10 competitors"}
                  onClick={() => {
                    setBusy(r.domain);
                    setError(null);
                    start(async () => {
                      const res = await addCompetitorAction(projectId, r.domain);
                      setBusy(null);
                      if (!res.ok) return setError(res.error);
                      router.refresh();
                    });
                  }}
                >
                  <Plus className="h-3.5 w-3.5" /> Track
                </Button>
              ),
          },
        ]}
      />
    </>
  );
}
