"use client";

import { ArrowDown, ArrowUp, Copy, Download, GripVertical, MoreHorizontal, Pencil, Plus, Printer, Settings2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteDashboardAction, previewWidgetAction, updateDashboardAction } from "@/app/(app)/cx/dashboards/actions";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, Menu, MenuItem } from "@/components/ui/dialog";
import { Callout, EmptyState, Spinner } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { CHART_LABELS, GROUP_LABELS, RANGE_OPTIONS, SOURCES, defaultWidget, formatMetric, metricDef, type ChartType, type GroupBy, type Source, type Widget, type WidgetResult } from "@/lib/cx/insights/widget-defs";
import { WidgetView } from "./widget-view";

type Meta = { id: string; name: string; description: string; shared: boolean; creator: string | null };
type Options = { channels: string[]; tags: string[] };
const SPAN = { 1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3" } as const;
const newId = () => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function csvRows(w: Widget, r: WidgetResult) {
  const def = metricDef(w);
  if (w.groupBy === "none" || !r.rows.length) return [["Widget", "Metric", "Value", "Previous period"], [w.title, def?.label ?? w.metric, r.total ?? "n/a", r.previous ?? "n/a"]];
  return [[GROUP_LABELS[w.groupBy], def?.label ?? w.metric], ...r.rows.map((x) => [x.key, x.value == null ? "n/a" : Math.round(x.value * 100) / 100])];
}

export function DashboardBoard({ brand, meta, widgets: initial, results: initialResults, options, print }: { brand: string; meta: Meta; widgets: Widget[]; results: Record<string, WidgetResult>; options: Options; print: boolean }) {
  const router = useRouter();
  const [widgets, setWidgets] = useState(initial);
  const [results, setResults] = useState(initialResults);
  const [edit, setEdit] = useState<Widget | null>(null);
  const [settings, setSettings] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => setWidgets(initial), [initial]);
  useEffect(() => setResults(initialResults), [initialResults]);

  const persist = (next: Widget[]) => {
    setWidgets(next);
    start(async () => {
      const r = await updateDashboardAction(brand, meta.id, { widgets: next });
      if (!r.ok) setError(r.error);
      else setError(null);
    });
  };
  const move = (id: string, to: number) => {
    const from = widgets.findIndex((w) => w.id === id);
    if (from < 0 || to < 0 || to >= widgets.length || from === to) return;
    const next = [...widgets];
    const [w] = next.splice(from, 1);
    next.splice(to, 0, w);
    persist(next);
  };
  const exportAll = () =>
    downloadCsv(
      `${meta.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`,
      widgets.flatMap((w) => [[`# ${w.title} (${SOURCES[w.source].label}, last ${w.range} days)`], ...csvRows(w, results[w.id] ?? { rows: [], total: null, previous: null }), []]),
    );

  return (
    <>
      {!print && (
        <div className="no-print mb-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => setEdit({ ...defaultWidget(newId()) })}>
            <Plus className="h-4 w-4" /> Add widget
          </Button>
          <Button onClick={exportAll} disabled={!widgets.length}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <ButtonLink href={`/cx/dashboards/${meta.id}?brand=${brand}&print=1`} target="_blank">
            <Printer className="h-4 w-4" /> Printable view
          </ButtonLink>
          <Button variant="ghost" onClick={() => setSettings(true)}>
            <Settings2 className="h-4 w-4" /> Settings
          </Button>
          {pending && <Spinner className="h-4 w-4" />}
          <span className="ml-auto hidden text-[12px] text-text-3 sm:inline">Drag widgets by their handle to reorder.</span>
        </div>
      )}
      {error && <Callout tone="critical" className="mb-4">{error}</Callout>}
      {widgets.length === 0 ? (
        <Card>
          <EmptyState title="This dashboard is empty" description="Add widgets that chart tickets, messages, mentions, survey responses or QA reviews." action={<Button variant="primary" onClick={() => setEdit({ ...defaultWidget(newId()) })}><Plus className="h-4 w-4" /> Add widget</Button>} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {widgets.map((w, i) => {
            const r = results[w.id];
            return (
              <div
                key={w.id}
                className={cn(SPAN[w.size], "min-w-0 break-inside-avoid", over === w.id && drag !== w.id && "rounded-lg ring-2 ring-brand")}
                onDragOver={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  setOver(w.id);
                }}
                onDragLeave={() => setOver((o) => (o === w.id ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag) move(drag, i);
                  setDrag(null);
                  setOver(null);
                }}
              >
                <Card className={cn("h-full", drag === w.id && "opacity-50")}>
                  <CardHeader
                    title={
                      <span className="flex items-center gap-1.5">
                        {!print && (
                          <span draggable onDragStart={() => setDrag(w.id)} onDragEnd={() => { setDrag(null); setOver(null); }} className="no-print -ml-1 cursor-grab text-text-3 hover:text-text" aria-label="Drag to reorder" title="Drag to reorder">
                            <GripVertical className="h-4 w-4" />
                          </span>
                        )}
                        {w.title}
                      </span>
                    }
                    description={`${SOURCES[w.source].label} · last ${w.range} days${Object.values(w.filters).some(Boolean) ? ` · ${Object.entries(w.filters).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(", ")}` : ""}`}
                    actions={
                      !print && (
                        <Menu align="right" trigger={() => <span className="no-print inline-flex h-7 w-7 items-center justify-center rounded-md text-text-3 hover:bg-surface-3" aria-label="Widget menu"><MoreHorizontal className="h-4 w-4" /></span>}>
                          {(close) => (
                            <>
                              <MenuItem icon={<Pencil className="h-4 w-4" />} onClick={() => { close(); setEdit(w); }}>Edit</MenuItem>
                              <MenuItem icon={<Copy className="h-4 w-4" />} onClick={() => { close(); const c = { ...w, id: newId(), title: `${w.title} (copy)` }; setResults({ ...results, [c.id]: results[w.id] }); persist([...widgets.slice(0, i + 1), c, ...widgets.slice(i + 1)]); }}>Duplicate</MenuItem>
                              {([1, 2, 3] as const).filter((s) => s !== w.size).map((s) => (
                                <MenuItem key={s} onClick={() => { close(); persist(widgets.map((x) => (x.id === w.id ? { ...x, size: s } : x))); }}>Width: {s === 1 ? "one third" : s === 2 ? "two thirds" : "full row"}</MenuItem>
                              ))}
                              {i > 0 && <MenuItem icon={<ArrowUp className="h-4 w-4" />} onClick={() => { close(); move(w.id, i - 1); }}>Move earlier</MenuItem>}
                              {i < widgets.length - 1 && <MenuItem icon={<ArrowDown className="h-4 w-4" />} onClick={() => { close(); move(w.id, i + 1); }}>Move later</MenuItem>}
                              <MenuItem icon={<Download className="h-4 w-4" />} onClick={() => { close(); if (r) downloadCsv(`${w.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`, csvRows(w, r)); }}>Export CSV</MenuItem>
                              <MenuItem danger icon={<Trash2 className="h-4 w-4" />} onClick={() => { close(); persist(widgets.filter((x) => x.id !== w.id)); }}>Remove</MenuItem>
                            </>
                          )}
                        </Menu>
                      )
                    }
                  />
                  <CardBody>{r ? <WidgetView widget={w} result={r} /> : <p className="py-8 text-center text-[13px] text-text-3">Refresh to load this widget.</p>}</CardBody>
                </Card>
              </div>
            );
          })}
        </div>
      )}
      {edit && (
        <WidgetBuilder
          brand={brand}
          initial={edit}
          options={options}
          isNew={!widgets.some((w) => w.id === edit.id)}
          onClose={() => setEdit(null)}
          onSave={(w, r) => {
            setResults({ ...results, [w.id]: r });
            persist(widgets.some((x) => x.id === w.id) ? widgets.map((x) => (x.id === w.id ? w : x)) : [...widgets, w]);
            setEdit(null);
          }}
        />
      )}
      <SettingsDialog open={settings} onClose={() => setSettings(false)} brand={brand} meta={meta} onSaved={() => router.refresh()} onDeleted={() => router.push(`/cx/dashboards?brand=${brand}`)} />
    </>
  );
}

function WidgetBuilder({ brand, initial, options, isNew, onClose, onSave }: { brand: string; initial: Widget; options: Options; isNew: boolean; onClose: () => void; onSave: (w: Widget, r: WidgetResult) => void }) {
  const [w, setW] = useState<Widget>(initial);
  const [preview, setPreview] = useState<{ widget: Widget; result: WidgetResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [titleTouched, setTitleTouched] = useState(!isNew);
  const seq = useRef(0);
  const src = SOURCES[w.source];

  useEffect(() => {
    const n = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await previewWidgetAction(brand, w);
      if (n !== seq.current) return;
      setLoading(false);
      if (r.ok) {
        setPreview(r.data);
        setError(null);
      } else setError(r.error);
    }, 350);
    return () => clearTimeout(t);
  }, [brand, w]);

  const patch = (p: Partial<Widget>) => {
    const next = { ...w, ...p };
    const s = SOURCES[next.source];
    if (!s.metrics.some((m) => m.id === next.metric)) next.metric = s.metrics[0].id;
    if (next.chart === "kpi") next.groupBy = "none";
    else if (next.chart === "line") next.groupBy = "date";
    else if (next.groupBy === "none" || !s.groups.includes(next.groupBy)) next.groupBy = s.groups.find((g) => g !== "none" && g !== "date") ?? "date";
    next.filters = Object.fromEntries(Object.entries(next.filters).filter(([k]) => s.filters.includes(k as never)));
    if (!titleTouched) next.title = `${s.metrics.find((m) => m.id === next.metric)?.label ?? "Value"}${next.groupBy !== "none" && next.groupBy !== "date" ? ` by ${GROUP_LABELS[next.groupBy].split(" ")[0].toLowerCase()}` : ""}`;
    setW(next);
  };
  const filterField = (k: keyof Widget["filters"], label: string, choices: string[], free = false) => (
    <Field label={label} htmlFor={`wf-${k}`}>
      {free ? (
        <>
          <Input id={`wf-${k}`} list={`wf-${k}-list`} value={w.filters[k] ?? ""} placeholder="Any" onChange={(e) => patch({ filters: { ...w.filters, [k]: e.target.value || undefined } })} />
          <datalist id={`wf-${k}-list`}>
            {choices.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </>
      ) : (
        <Select id={`wf-${k}`} value={w.filters[k] ?? ""} onChange={(e) => patch({ filters: { ...w.filters, [k]: e.target.value || undefined } })}>
          <option value="">Any</option>
          {choices.map((c) => (
            <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
          ))}
        </Select>
      )}
    </Field>
  );
  const groupChoices = src.groups.filter((g) => (w.chart === "kpi" ? g === "none" : w.chart === "line" ? g === "date" : g !== "none"));

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={isNew ? "Add widget" : "Edit widget"}
      description="Pick a data source, a metric and how to slice it. Everything is computed from records stored for this brand."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!preview || !!error || !w.title.trim()} onClick={() => preview && onSave({ ...preview.widget, title: w.title.trim() }, preview.result)}>
            {isNew ? "Add to dashboard" : "Save widget"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-3">
          <Field label="Title" htmlFor="w-title">
            <Input id="w-title" value={w.title} onChange={(e) => { setTitleTouched(true); setW({ ...w, title: e.target.value }); }} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Data source" htmlFor="w-source">
              <Select id="w-source" value={w.source} onChange={(e) => patch({ source: e.target.value as Source })}>
                {Object.entries(SOURCES).map(([k, s]) => (
                  <option key={k} value={k}>{s.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Metric" htmlFor="w-metric">
              <Select id="w-metric" value={w.metric} onChange={(e) => patch({ metric: e.target.value })}>
                {src.metrics.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Chart" htmlFor="w-chart">
              <Select id="w-chart" value={w.chart} onChange={(e) => patch({ chart: e.target.value as ChartType })}>
                {Object.entries(CHART_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </Select>
            </Field>
            <Field label="Group by" htmlFor="w-group">
              <Select id="w-group" value={w.groupBy} onChange={(e) => patch({ groupBy: e.target.value as GroupBy })} disabled={groupChoices.length < 2}>
                {groupChoices.map((g) => (
                  <option key={g} value={g}>{GROUP_LABELS[g]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Date range" htmlFor="w-range">
              <Select id="w-range" value={w.range} onChange={(e) => patch({ range: Number(e.target.value) })}>
                {RANGE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Width" htmlFor="w-size">
              <Select id="w-size" value={w.size} onChange={(e) => patch({ size: Number(e.target.value) as Widget["size"] })}>
                <option value={1}>One third</option>
                <option value={2}>Two thirds</option>
                <option value={3}>Full row</option>
              </Select>
            </Field>
          </div>
          <div>
            <div className="mb-1.5 text-[12.5px] font-semibold text-text">Filters</div>
            <div className="grid grid-cols-2 gap-3">
              {src.filters.includes("channel") && filterField("channel", w.source === "mentions" ? "Source" : "Channel", options.channels, true)}
              {src.filters.includes("sentiment") && filterField("sentiment", "Sentiment", ["positive", "neutral", "negative"])}
              {src.filters.includes("priority") && filterField("priority", "Priority", ["urgent", "high", "normal", "low"])}
              {src.filters.includes("status") && filterField("status", "Status", ["new", "open", "pending", "on_hold", "solved", "closed"])}
              {src.filters.includes("tag") && filterField("tag", "Tag", options.tags, true)}
            </div>
          </div>
        </div>
        <div className="min-w-0 rounded-lg border border-border bg-surface-2 p-3">
          <div className="mb-2 flex items-center justify-between text-[12.5px] font-semibold text-text">
            Preview {loading && <Spinner className="h-3.5 w-3.5" />}
          </div>
          {error ? <Callout tone="critical">{error}</Callout> : preview ? <WidgetView widget={{ ...preview.widget, title: w.title }} result={preview.result} height={200} /> : <div className="py-12 text-center"><Spinner className="mx-auto h-5 w-5" /></div>}
          {preview && preview.widget.chart !== "kpi" && <p className="mt-2 text-[12px] text-text-3">Total: {formatMetric(preview.result.total, metricDef(preview.widget)?.format ?? "number")}</p>}
        </div>
      </div>
    </Dialog>
  );
}

function SettingsDialog({ open, onClose, brand, meta, onSaved, onDeleted }: { open: boolean; onClose: () => void; brand: string; meta: Meta; onSaved: () => void; onDeleted: () => void }) {
  const [name, setName] = useState(meta.name);
  const [description, setDescription] = useState(meta.description);
  const [shared, setShared] = useState(meta.shared);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Dashboard settings"
      footer={
        <>
          <Button variant="danger" className="mr-auto" disabled={pending} onClick={() => confirm("Delete this dashboard?") && start(async () => { const r = await deleteDashboardAction(brand, meta.id); if (r.ok) onDeleted(); else setError(r.error); })}>
            Delete
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={() => start(async () => { const r = await updateDashboardAction(brand, meta.id, { name, description, shared }); if (r.ok) { onClose(); onSaved(); } else setError(r.error); })}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Callout tone="critical">{error}</Callout>}
        <Field label="Name" htmlFor="d-name">
          <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="d-desc">
          <Textarea id="d-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-[13px] text-text">
          <Checkbox checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share with everyone on this brand
          <Badge tone={shared ? "good" : "neutral"}>{shared ? "Shared" : "Private"}</Badge>
        </label>
      </div>
    </Dialog>
  );
}
