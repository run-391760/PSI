"use client";

import { Crosshair, MapPin, Plus, Radar, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { deleteScanAction, scanScheduleAction, startScanAction } from "@/app/(app)/local/actions";
import { dateTimeLabel } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/input";
import { GeoGrid, RankLegend, bandFor, type GridPoint } from "./geo-grid";

const GRIDS = [3, 5, 7, 9] as const;
const RADII = [1, 2, 3, 5, 10];

export function ScanForm({ projectId, suggestions, defaults, onDone }: { projectId: string; suggestions: string[]; defaults?: { keywords: string[]; grid: number; radiusKm: number }; onDone?: () => void }) {
  const router = useRouter();
  const [keywords, setKeywords] = useState((defaults?.keywords ?? suggestions.slice(0, 2)).join("\n"));
  const [grid, setGrid] = useState<string>(String(defaults?.grid ?? 5));
  const [radius, setRadius] = useState(String(defaults?.radiusKm ?? 3));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const list = keywords
    .split(/\n|,/)
    .map((k) => k.trim())
    .filter(Boolean);
  const g = Number(grid);
  const r = Number(radius);
  const spacing = g > 1 ? (2 * r) / (g - 1) : 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!list.length) return setError("Add at least one keyword.");
    if (list.length > 5) return setError("A scan can track up to 5 keywords.");
    if (!(r >= 0.5 && r <= 25)) return setError("Radius must be between 0.5 and 25 km.");
    setError(null);
    start(async () => {
      const res = await startScanAction(projectId, { keywords: list, grid: g, radiusKm: r });
      if (!res.ok) return setError(res.error);
      onDone?.();
      router.push(`/local/map-rank-tracker?project=${projectId}&scan=${res.data.scanId}`);
      router.refresh();
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Callout tone="critical">{error}</Callout>}
      <Field label="Keywords" htmlFor="scan-kw" hint={`One per line, up to 5 (${list.length}/5).`}>
        <Textarea id="scan-kw" value={keywords} onChange={(e) => setKeywords(e.target.value)} rows={4} className="min-h-0" placeholder={"dentist near me\nbest dentist in austin"} />
      </Field>
      {suggestions.length > 0 && (
        <div className="-mt-2 flex flex-wrap gap-1.5">
          {suggestions
            .filter((s) => !list.includes(s))
            .map((s) => (
              <button key={s} type="button" onClick={() => setKeywords((k) => (k.trim() ? `${k.trim()}\n${s}` : s))} className="inline-flex h-6 items-center gap-1 rounded-full border border-border-strong px-2 text-[12px] text-text-2 hover:bg-surface-3 hover:text-text">
                <Plus className="h-3 w-3" /> {s}
              </button>
            ))}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-[12.5px] font-medium text-text-2">Grid size</span>
          {/* Own buttons (type="button"): the shared Segmented control would submit the form. */}
          <div className="inline-flex rounded-md border border-border-strong bg-surface p-0.5" role="radiogroup" aria-label="Grid size">
            {GRIDS.map((x) => (
              <button
                key={x}
                type="button"
                role="radio"
                aria-checked={grid === String(x)}
                onClick={() => setGrid(String(x))}
                className={`h-7 rounded px-2.5 text-[13px] font-medium transition-colors ${grid === String(x) ? "bg-brand-soft text-brand-ink" : "text-text-2 hover:text-text"}`}
              >
                {x}×{x}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[12px] text-text-3">{g * g} points per keyword</p>
        </div>
        <Field label="Radius (km)" htmlFor="scan-radius" hint={`Grid spacing ${spacing.toFixed(spacing < 1 ? 2 : 1)} km`}>
          <div className="flex items-center gap-2">
            <Input id="scan-radius" type="number" min={0.5} max={25} step={0.5} value={radius} onChange={(e) => setRadius(e.target.value)} className="w-24" />
            <div className="flex flex-wrap gap-1">
              {RADII.map((x) => (
                <button key={x} type="button" onClick={() => setRadius(String(x))} className={`h-7 rounded px-2 text-[12px] ${Number(radius) === x ? "bg-brand-soft font-medium text-brand-ink" : "text-text-2 hover:bg-surface-3"}`}>
                  {x}
                </button>
              ))}
            </div>
          </div>
        </Field>
      </div>
      <p className="text-[12px] text-text-3">
        {list.length * g * g} grid checks · Demo simulation: rankings are generated deterministically, not fetched from Google Maps.
      </p>
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" loading={pending}>
          <Radar className="h-4 w-4" /> Run scan
        </Button>
      </div>
    </form>
  );
}

export function NewScanButton(props: { projectId: string; suggestions: string[]; defaults?: { keywords: string[]; grid: number; radiusKm: number }; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)} disabled={props.disabled} title={props.disabled ? "A scan is already running" : undefined}>
        <Radar className="h-4 w-4" /> New scan
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New grid scan" description="Check where you appear in the local pack from points around your business." size="lg">
        <ScanForm {...props} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

export function ScheduleToggle({ projectId, enabled, settings }: { projectId: string; enabled: boolean; settings: { keywords: string[]; grid: number; radiusKm: number } | null }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="inline-flex h-8.5 cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-[13px] text-text shadow-card" title={error ?? (settings ? `Weekly: ${settings.keywords.join(", ")} · ${settings.grid}×${settings.grid} · ${settings.radiusKm} km` : "Run a scan first")}>
      <Checkbox
        checked={on}
        disabled={pending || !settings}
        onChange={(e) => {
          const next = e.target.checked;
          setOn(next);
          start(async () => {
            const res = await scanScheduleAction(projectId, { enabled: next, keywords: settings?.keywords ?? [], grid: settings?.grid ?? 5, radiusKm: settings?.radiusKm ?? 3 });
            if (!res.ok) {
              setOn(!next);
              setError(res.error);
            }
            router.refresh();
          });
        }}
      />
      Rescan weekly
    </label>
  );
}

/** Heatmap with a click-to-inspect panel showing the local pack at a grid point. */
export function HeatmapPanel({ cells, grid, seed, businessName }: { cells: GridPoint[]; grid: number; seed: string; businessName: string }) {
  const centerKey = `${(grid - 1) / 2}:${(grid - 1) / 2}`;
  const [selected, setSelected] = useState<string>(centerKey);
  const cell = cells.find((c) => `${c.row}:${c.col}` === selected) ?? cells[0];
  const band = bandFor(cell?.rank ?? null);
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
      <div>
        <GeoGrid cells={cells} grid={grid} seed={seed} selected={selected} onSelect={setSelected} />
        <RankLegend className="mt-2.5" />
      </div>
      {cell && (
        <div className="rounded-lg border border-border bg-surface-2 p-3 text-[12.5px]">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-text-3">
            <Crosshair className="h-3.5 w-3.5" /> {`${cell.row}:${cell.col}` === centerKey ? "Your location" : `Grid point ${cell.row + 1}·${cell.col + 1}`}
          </div>
          <div className="tabular mt-0.5 text-[11.5px] text-text-3">
            {cell.lat.toFixed(4)}, {cell.lng.toFixed(4)}
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="text-[26px] font-semibold text-text">{cell.rank == null ? "20+" : `#${cell.rank}`}</span>
            <span className="text-text-2">{band.note}</span>
          </div>
          <div className="mt-3 border-t border-border pt-2.5">
            <div className="mb-1.5 text-[11.5px] font-semibold tracking-wide text-text-3 uppercase">Local pack here</div>
            <ol className="space-y-1.5">
              {cell.pack.map((name, i) => (
                <li key={name} className="flex items-start gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-semibold text-text-2">{i + 1}</span>
                  <span className={name === businessName ? "font-semibold text-text" : "text-text-2"}>
                    {name}
                    {name === businessName && <span className="ml-1 text-[11px] font-normal text-brand-ink">(you)</span>}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <p className="mt-3 flex items-center gap-1 text-[11.5px] text-text-3">
            <MapPin className="h-3 w-3" /> Click any point on the grid.
          </p>
        </div>
      )}
    </div>
  );
}

export function CompareGrids({ current, previous, grid, seed, currentLabel, previousLabel }: { current: GridPoint[]; previous: GridPoint[]; grid: number; seed: string; currentLabel: string; previousLabel: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <figure>
        <GeoGrid cells={previous} grid={grid} seed={seed} label={`Previous scan ${previousLabel}`} />
        <figcaption className="mt-1.5 text-center text-[12px] text-text-2">Before · {previousLabel}</figcaption>
      </figure>
      <figure>
        <GeoGrid cells={current} grid={grid} seed={seed} label={`Current scan ${currentLabel}`} />
        <figcaption className="mt-1.5 text-center text-[12px] text-text-2">After · {currentLabel}</figcaption>
      </figure>
      <figure>
        <GeoGrid cells={current} previous={previous} grid={grid} seed={seed} mode="delta" label="Rank change" />
        <figcaption className="mt-1.5 text-center text-[12px] text-text-2">Change (positions)</figcaption>
      </figure>
    </div>
  );
}

export type HistoryRow = { id: string; createdAt: string; keywords: string[]; grid: number; radiusKm: number; status: string; avgRank: number | null; solv: number | null; top3Pct: number | null };

export function ScanHistory({ projectId, rows, currentId, compareId }: { projectId: string; rows: HistoryRow[]; currentId: string | null; compareId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const base = `/local/map-rank-tracker?project=${projectId}`;
  const columns: Column<HistoryRow>[] = [
    {
      key: "createdAt",
      header: "Scan",
      sortValue: (r) => r.createdAt,
      render: (r) => (
        <Link href={`${base}&scan=${r.id}`} className="whitespace-nowrap text-link hover:underline" suppressHydrationWarning>
          {dateTimeLabel(r.createdAt)}
        </Link>
      ),
    },
    { key: "keywords", header: "Keywords", sortValue: (r) => r.keywords.join(", "), render: (r) => <span className="block max-w-[320px] truncate" title={r.keywords.join(", ")}>{r.keywords.join(", ")}</span> },
    { key: "grid", header: "Grid", align: "right", render: (r) => `${r.grid}×${r.grid} · ${r.radiusKm} km`, csv: (r) => `${r.grid}x${r.grid} ${r.radiusKm}km` },
    { key: "avgRank", header: "Avg. rank", align: "right", sortValue: (r) => r.avgRank ?? 99, render: (r) => (r.avgRank == null ? <span className="text-text-3">n/a</span> : r.avgRank.toFixed(1)) },
    { key: "solv", header: "SoLV", align: "right", info: "Share of local voice", sortValue: (r) => r.solv ?? -1, render: (r) => (r.solv == null ? <span className="text-text-3">n/a</span> : `${r.solv}%`) },
    { key: "top3Pct", header: "Top 3", align: "right", sortValue: (r) => r.top3Pct ?? -1, render: (r) => (r.top3Pct == null ? <span className="text-text-3">n/a</span> : `${r.top3Pct}%`) },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <span className="inline-flex gap-1">
          <Badge tone={r.status === "done" ? "good" : r.status === "failed" ? "critical" : r.status === "cancelled" ? "neutral" : "info"}>{r.status === "done" ? "Complete" : r.status[0].toUpperCase() + r.status.slice(1)}</Badge>
          {r.id === currentId && <Badge tone="brand">Viewing</Badge>}
          {r.id === compareId && <Badge>Compared</Badge>}
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
        <span className="inline-flex items-center gap-1">
          {currentId && r.id !== currentId && r.status === "done" && (
            <Link href={`${base}&scan=${currentId}&compare=${r.id}`} className="rounded px-2 py-1 text-[12.5px] text-link hover:bg-surface-3">
              Compare
            </Link>
          )}
          {r.status !== "queued" && r.status !== "running" && (
            <Button
              size="sm"
              variant="ghost"
              aria-label="Delete scan"
              disabled={pending}
              onClick={() =>
                confirm("Delete this scan?") &&
                start(async () => {
                  await deleteScanAction(projectId, r.id);
                  router.push(base);
                  router.refresh();
                })
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </span>
      ),
    },
  ];
  return <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} defaultSort={{ key: "createdAt", dir: "desc" }} pageSize={10} exportName="map-scans" dense />;
}
