"use client";

import { MonitorSmartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { updateCampaignAction } from "@/app/(app)/position-tracking/actions";
import { compact, displayUrl } from "@/lib/format";
import type { DeviceMode } from "@/lib/position-tracking/types";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Select } from "@/components/ui/input";
import { Pos } from "./ui";

export type DeviceRow = { id: string; keyword: string; volume: number | null; desktop: number | null; mobile: number | null; diff: number | null; desktopUrl: string | null; mobileUrl: string | null };

export function DevicesTable({ rows, exportName, kwBase }: { rows: DeviceRow[]; exportName: string; kwBase: string }) {
  const [filter, setFilter] = useState("all");
  const visible = useMemo(
    () =>
      rows.filter((r) => {
        if (filter === "mobile") return (r.diff ?? 0) > 0 || (r.desktop == null && r.mobile != null);
        if (filter === "desktop") return (r.diff ?? 0) < 0 || (r.mobile == null && r.desktop != null);
        if (filter === "gap5") return r.diff != null && Math.abs(r.diff) >= 5;
        if (filter === "url") return r.desktopUrl != null && r.mobileUrl != null && r.desktopUrl !== r.mobileUrl;
        return true;
      }),
    [rows, filter],
  );
  return (
    <DataTable
      rows={visible}
      rowKey={(r) => r.id}
      defaultSort={{ key: "gap", dir: "desc" }}
      exportName={exportName}
      searchable
      searchText={(r) => r.keyword}
      toolbar={
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 w-auto text-[12.5px]" aria-label="Device filter">
          <option value="all">All keywords</option>
          <option value="mobile">Better on mobile</option>
          <option value="desktop">Better on desktop</option>
          <option value="gap5">Gap of 5+ positions</option>
          <option value="url">Different landing page</option>
        </Select>
      }
      columns={[
        {
          key: "keyword",
          header: "Keyword",
          sortValue: (r) => r.keyword,
          render: (r) => (
            <a href={`${kwBase}&kw=${r.id}`} className="text-link hover:underline">
              {r.keyword}
            </a>
          ),
        },
        { key: "volume", header: "Volume", align: "right", render: (r) => (r.volume == null ? "n/a" : compact(r.volume)) },
        { key: "desktop", header: "Desktop", align: "right", render: (r) => <Pos value={r.desktop} strong /> },
        { key: "mobile", header: "Mobile", align: "right", render: (r) => <Pos value={r.mobile} strong /> },
        {
          key: "gap",
          header: "Difference",
          align: "right",
          info: "Desktop position minus mobile position: positive = ranks better on mobile.",
          sortValue: (r) => (r.diff == null ? null : Math.abs(r.diff)),
          render: (r) =>
            r.diff == null ? (
              <span className="text-text-3">–</span>
            ) : r.diff === 0 ? (
              <span className="text-text-3">same</span>
            ) : (
              <span className="tabular text-[12.5px] text-text-2">
                {Math.abs(r.diff)} better on <span className="font-medium text-text">{r.diff > 0 ? "mobile" : "desktop"}</span>
              </span>
            ),
          csv: (r) => r.diff,
        },
        {
          key: "urls",
          header: "Landing page",
          sortable: false,
          render: (r) =>
            r.desktopUrl && r.mobileUrl && r.desktopUrl !== r.mobileUrl ? (
              <span className="block max-w-[320px] text-[12px]">
                <span className="block truncate" title={r.desktopUrl}>
                  <span className="text-text-3">Desktop </span>
                  {displayUrl(r.desktopUrl).replace(/^www\./, "")}
                </span>
                <span className="block truncate" title={r.mobileUrl}>
                  <span className="text-text-3">Mobile </span>
                  {displayUrl(r.mobileUrl).replace(/^www\./, "")}
                </span>
              </span>
            ) : r.desktopUrl || r.mobileUrl ? (
              <span className="block max-w-[320px] truncate text-[12.5px] text-text-2" title={r.desktopUrl ?? r.mobileUrl ?? ""}>
                {displayUrl((r.desktopUrl ?? r.mobileUrl)!).replace(/^www\./, "")}
              </span>
            ) : (
              <span className="text-text-3">–</span>
            ),
          csv: (r) => [r.desktopUrl, r.mobileUrl].filter(Boolean).join(" | "),
        },
      ]}
    />
  );
}

/** Switches a single-device campaign to desktop + mobile (the new device's history is backfilled in demo mode). */
export function TrackBothButton({ projectId, campaign }: { projectId: string; campaign: { db: string; location: string; competitors: string[]; device: DeviceMode } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        variant="primary"
        loading={pending}
        onClick={() =>
          start(async () => {
            const res = await updateCampaignAction(projectId, { ...campaign, device: "both" });
            if (!res.ok) return setError(res.error);
            router.refresh();
          })
        }
      >
        <MonitorSmartphone className="h-4 w-4" /> Track desktop & mobile
      </Button>
      {error && <span className="text-[12px] text-critical-ink">{error}</span>}
    </span>
  );
}
