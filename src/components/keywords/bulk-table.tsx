"use client";

import { ListPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { compact, money } from "@/lib/format";
import type { KwRow } from "@/lib/keywords/types";
import { INTENT_META, IntentBadges, KdBadge, KeywordLink, SerpFeatureIcons, TrendBars, featureLabel } from "@/components/seo/badges";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { AddToListDialog } from "./add-to-list";

export type BulkRow = KwRow & { globalVolume: number | null };
const na = <span className="text-text-3">n/a</span>;

/** Keyword metrics table with selection → Add to list and CSV export (bulk Keyword Overview, lists). */
export function KeywordMetricsTable({
  rows,
  db,
  exportName,
  listName,
  from = "keyword-overview",
  showGlobal = true,
}: {
  rows: BulkRow[];
  db: string;
  exportName: string;
  listName?: string;
  from?: string;
  showGlobal?: boolean;
}) {
  const [dialog, setDialog] = useState<string[] | null>(null);
  const columns = useMemo<Column<BulkRow>[]>(() => {
    const cols: Column<BulkRow>[] = [
      { key: "keyword", header: "Keyword", sortValue: (r) => r.keyword, render: (r) => <KeywordLink keyword={r.keyword} db={db} className="whitespace-nowrap" /> },
      { key: "intent", header: "Intent", sortValue: (r) => r.intents[0] ?? "", render: (r) => (r.intents.length ? <IntentBadges intents={r.intents} /> : na), csv: (r) => r.intents.map((i) => INTENT_META[i].label).join("; ") },
      { key: "volume", header: "Volume", align: "right", sortValue: (r) => r.volume, render: (r) => (r.volume == null ? na : r.volume.toLocaleString()) },
    ];
    if (showGlobal) cols.push({ key: "globalVolume", header: "Global vol.", align: "right", sortValue: (r) => r.globalVolume, render: (r) => (r.globalVolume == null ? na : compact(r.globalVolume)) });
    cols.push(
      { key: "trend", header: "Trend", sortable: false, render: (r) => (r.trend.length ? <TrendBars values={r.trend} width={56} height={16} /> : na), csv: (r) => r.trend.join(" ") },
      { key: "kd", header: "KD %", align: "right", sortValue: (r) => r.kd, render: (r) => <KdBadge kd={r.kd} /> },
      { key: "cpc", header: "CPC (USD)", align: "right", sortValue: (r) => r.cpc, render: (r) => (r.cpc == null ? na : money(r.cpc)) },
      { key: "competition", header: "Com.", align: "right", sortValue: (r) => r.competition, render: (r) => (r.competition == null ? na : r.competition.toFixed(2)) },
      { key: "features", header: "SERP features", sortValue: (r) => r.features.length, render: (r) => <SerpFeatureIcons features={r.features} max={4} />, csv: (r) => r.features.map(featureLabel).join("; ") },
      { key: "results", header: "Results", align: "right", sortValue: (r) => r.results, render: (r) => compact(r.results) },
    );
    return cols;
  }, [db, showGlobal]);
  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.keyword}
        defaultSort={{ key: "volume", dir: "desc" }}
        pageSize={50}
        searchable
        searchText={(r) => r.keyword}
        selectable
        exportName={exportName}
        selectionActions={(sel, clear) => (
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setDialog(sel.map((r) => r.keyword));
              clear();
            }}
          >
            <ListPlus className="h-3.5 w-3.5" /> Add to list
          </Button>
        )}
      />
      <AddToListDialog open={dialog !== null} onClose={() => setDialog(null)} keywords={dialog ?? []} db={db} defaultName={listName} from={from} />
    </>
  );
}
