"use client";

import { ArrowDown, ArrowUp, Copy, Download, GripVertical, ImageDown, Link2, MoreHorizontal, Pencil, Plus, Printer, Settings2, Sparkles, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createShareAction, deleteDashboardAction, previewWidgetAction, revokeShareAction, updateDashboardAction, widgetInsightAction } from "@/app/(app)/cx/dashboards/actions";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, Menu, MenuItem } from "@/components/ui/dialog";
import { Callout, EmptyState, Spinner } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { CHART_LABELS, GROUP_LABELS, RANGE_OPTIONS, SOURCES, THEMES, chartsFor, defaultWidget, formatMetric, groupLabel, metricDef, rangeLabel, themeVars, type ChartType, type DashboardFilters, type FieldFilter, type GroupBy, type Source, type Widget, type WidgetResult } from "@/lib/cx/insights/widget-defs";
import { downloadNodePng, slug } from "./png-export";
import { WidgetView } from "./widget-view";

type Meta = { id: string; name: string; description: string; shared: boolean; creator: string | null; theme: string; filters: DashboardFilters };
type Options = { channels: string[]; tags: string[]; fields: { key: string; label: string; options: string[] }[]; classifications: { id: string; label: string }[] };
type Share = { token: string; created_at: string; last_used_at: string | null };
const SPAN = { 1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3" } as const;
const newId = () => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function csvRows(w: Widget, r: WidgetResult) {
  const def = metricDef(w);
  if (r.multi) return [["Key", ...r.multi.series.map((s) => s.label)], ...r.multi.rows.map((x) => [String(x.key), ...r.multi!.series.map((s) => (x[s.key] == null ? "n/a" : Number(x[s.key])))])];
  if ((w.groupBy === "none" && w.metric !== "phrases") || !r.rows.length) return [["Widget", "Metric", "Value", "Previous period"], [w.title, def?.label ?? w.metric, r.total ?? "n/a", r.previous ?? "n/a"]];
  return [[w.metric === "phrases" ? "Phrase" : groupLabel(w.groupBy), def?.label ?? w.metric], ...r.rows.map((x) => [x.key, x.value == null ? "n/a" : Math.round(x.value * 100) / 100])];
}

export function DashboardBoard({ brand, meta, widgets: initial, results: initialResults, options, print, readonly, ai = false, shares = [] }: { brand: string; meta: Meta; widgets: Widget[]; results: Record<string, WidgetResult>; options: Options; print: boolean; readonly?: boolean; ai?: boolean; shares?: Share[] }) {
  const router = useRouter();
  const [widgets, setWidgets] = useState(initial);
  const [results, setResults] = useState(initialResults);
  const [edit, setEdit] = useState<Widget | null>(null);
  const [settings, setSettings] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [insights, setInsights] = useState<Record<string, { loading?: boolean; text?: string; error?: string }>>({});
  const cards = useRef<Record<string, HTMLDivElement | null>>({});
  const ro = print || !!readonly;
  const insight = (id: string) => {
    setInsights((x) => ({ ...x, [id]: { loading: true } }));
    widgetInsightAction(brand, meta.id, id).then((r) => setInsights((x) => ({ ...x, [id]: r.ok ? { text: r.data.text } : { error: r.error } })));
  };
  const png = (w: Widget) => {
    const el = cards.current[w.id];
    if (el) downloadNodePng(el, slug(w.title)).catch((e) => setError(e instanceof Error ? e.message : "PNG export failed"));
  };

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
      widgets.flatMap((w) => [[`# ${w.title} (${SOURCES[w.source].label}, ${rangeLabel(w)})`], ...csvRows(w, results[w.id] ?? { rows: [], total: null, previous: null }), []]),
    );

  return (
    <>
      {!ro && (
        <div className="no-print mb-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => setEdit({ ...defaultWidget(newId()) })}>
            <Plus className="h-4 w-4" /> Add widget
          </Button>
          <Button onClick={exportAll} disabled={!widgets.length}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <ButtonLink href={`/cx/dashboards/${meta.id}?brand=${brand}&print=1`} target="_blank">
            <Printer className="h-4 w-4" /> Print / PDF
          </ButtonLink>
          <Button variant="ghost" onClick={() => setSettings(true)}>
            <Settings2 className="h-4 w-4" /> Settings
          </Button>
          {pending && <Spinner className="h-4 w-4" />}
          <span className="ml-auto hidden text-[12px] text-text-3 sm:inline">Drag widgets by their handle to reorder.</span>
        </div>
      )}
      {error && <Callout tone="critical" className="mb-4">{error}</Callout>}
      {activeFilterText(meta.filters, options) && <p className="mb-3 text-[12.5px] text-text-2">Dashboard filters: {activeFilterText(meta.filters, options)}</p>}
      {widgets.length === 0 ? (
        <Card>
          <EmptyState title="This dashboard is empty" description="Add widgets that chart tickets, messages, mentions, survey responses or QA reviews." action={ro ? undefined : <Button variant="primary" onClick={() => setEdit({ ...defaultWidget(newId()) })}><Plus className="h-4 w-4" /> Add widget</Button>} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" style={themeVars(meta.theme) as React.CSSProperties}>
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
                <div ref={(el) => { cards.current[w.id] = el; }} className="h-full">
                <Card className={cn("h-full", drag === w.id && "opacity-50")}>
                  <CardHeader
                    title={
                      <span className="flex items-center gap-1.5">
                        {!ro && (
                          <span draggable onDragStart={() => setDrag(w.id)} onDragEnd={() => { setDrag(null); setOver(null); }} className="no-print -ml-1 cursor-grab text-text-3 hover:text-text" aria-label="Drag to reorder" title="Drag to reorder">
                            <GripVertical className="h-4 w-4" />
                          </span>
                        )}
                        {w.title}
                      </span>
                    }
                    description={`${SOURCES[w.source].label} · ${rangeLabel(w)}${Object.values(w.filters).some(Boolean) ? ` · ${Object.entries(w.filters).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(", ")}` : ""}${w.fields?.length ? ` · ${w.fields.map((f) => `${f.key}: ${f.value}`).join(", ")}` : ""}`}
                    actions={
                      readonly ? (
                        <Button size="icon" variant="ghost" className="no-print" aria-label="Download PNG" onClick={() => png(w)}><ImageDown className="h-4 w-4" /></Button>
                      ) : !print && (
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
                              <MenuItem icon={<ImageDown className="h-4 w-4" />} onClick={() => { close(); png(w); }}>Download PNG</MenuItem>
                              {ai && <MenuItem icon={<Sparkles className="h-4 w-4" />} onClick={() => { close(); insight(w.id); }}>AI insight</MenuItem>}
                              <MenuItem danger icon={<Trash2 className="h-4 w-4" />} onClick={() => { close(); persist(widgets.filter((x) => x.id !== w.id)); }}>Remove</MenuItem>
                            </>
                          )}
                        </Menu>
                      )
                    }
                  />
                  <CardBody>
                    {r ? <WidgetView widget={w} result={r} /> : <p className="py-8 text-center text-[13px] text-text-3">Refresh to load this widget.</p>}
                    {insights[w.id] && (
                      <div className="no-print mt-3 rounded-md border border-border bg-surface-2 p-2.5 text-[12.5px] text-text-2" data-no-export>
                        <div className="mb-1 flex items-center gap-1.5 font-semibold text-text"><Sparkles className="h-3.5 w-3.5" /> AI insight
                          <button type="button" className="ml-auto text-text-3 hover:text-text" aria-label="Close insight" onClick={() => setInsights((x) => { const n = { ...x }; delete n[w.id]; return n; })}><X className="h-3.5 w-3.5" /></button>
                        </div>
                        {insights[w.id].loading ? <Spinner className="h-4 w-4" /> : insights[w.id].error ? <span className="text-critical-ink">{insights[w.id].error}</span> : <p className="whitespace-pre-line">{insights[w.id].text}</p>}
                      </div>
                    )}
                  </CardBody>
                </Card>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {edit && (
        <WidgetBuilder
          brand={brand}
          dashboardId={meta.id}
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
      {!ro && <SettingsDialog open={settings} onClose={() => setSettings(false)} brand={brand} meta={meta} options={options} shares={shares} onSaved={() => router.refresh()} onDeleted={() => router.push(`/cx/dashboards?brand=${brand}`)} />}
    </>
  );
}

function WidgetBuilder({ brand, dashboardId, initial, options, isNew, onClose, onSave }: { brand: string; dashboardId: string; initial: Widget; options: Options; isNew: boolean; onClose: () => void; onSave: (w: Widget, r: WidgetResult) => void }) {
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
      const r = await previewWidgetAction(brand, w, dashboardId);
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
    const charts = chartsFor(next.source, next.metric);
    if (!charts.includes(next.chart)) next.chart = charts[0];
    if (next.chart === "kpi" || next.chart === "cloud") next.groupBy = "none";
    else if (next.chart === "stacked") next.groupBy = "agent";
    else if (next.chart === "line" || next.chart === "compare") next.groupBy = "date";
    else if (next.groupBy === "none" || !(s.groups.includes(next.groupBy as never) || (next.source === "tickets" && String(next.groupBy).startsWith("field:")))) next.groupBy = s.groups.find((g) => g !== "none" && g !== "date") ?? "date";
    next.filters = Object.fromEntries(Object.entries(next.filters).filter(([k]) => s.filters.includes(k as never)));
    if (!titleTouched) next.title = `${s.metrics.find((m) => m.id === next.metric)?.label ?? "Value"}${next.groupBy !== "none" && next.groupBy !== "date" ? ` by ${groupLabel(next.groupBy, options.fields).split(" ")[0].toLowerCase()}` : ""}`;
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
  const fieldGroups = w.source === "tickets" ? options.fields.map((f) => `field:${f.key}` as GroupBy) : [];
  const groupChoices: GroupBy[] = w.chart === "kpi" || w.chart === "cloud" ? ["none"] : w.chart === "line" || w.chart === "compare" ? ["date"] : w.chart === "stacked" ? ["agent"] : [...src.groups.filter((g) => g !== "none"), ...fieldGroups];
  const custom = !!(w.from && w.to);

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={isNew ? "Add widget" : "Edit widget"}
      description="Pick a data source, a metric and how to slice it. Everything is computed from records stored for this brand."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
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
                {chartsFor(w.source, w.metric).map((k) => (
                  <option key={k} value={k}>{CHART_LABELS[k]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Group by" htmlFor="w-group">
              <Select id="w-group" value={w.groupBy} onChange={(e) => patch({ groupBy: e.target.value as GroupBy })} disabled={groupChoices.length < 2}>
                {groupChoices.map((g) => (
                  <option key={g} value={g}>{g.startsWith("field:") ? `Field: ${groupLabel(g, options.fields)}` : GROUP_LABELS[g as keyof typeof GROUP_LABELS]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Date range" htmlFor="w-range">
              <Select
                id="w-range"
                value={custom ? "custom" : w.range}
                onChange={(e) => {
                  if (e.target.value === "custom") {
                    const to = new Date().toISOString().slice(0, 10);
                    patch({ from: new Date(Date.now() - (w.range - 1) * 86400000).toISOString().slice(0, 10), to });
                  } else patch({ range: Number(e.target.value), from: undefined, to: undefined });
                }}
              >
                {RANGE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
                <option value="custom">Custom range…</option>
              </Select>
            </Field>
            {custom && (
              <div className="col-span-2 grid grid-cols-2 gap-3">
                <Field label="From" htmlFor="w-from"><Input id="w-from" type="date" value={w.from} max={w.to} onChange={(e) => e.target.value && patch({ from: e.target.value })} /></Field>
                <Field label="To" htmlFor="w-to"><Input id="w-to" type="date" value={w.to} min={w.from} onChange={(e) => e.target.value && patch({ to: e.target.value })} /></Field>
              </div>
            )}
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
            {w.source !== "mentions" && (
              <FieldFilters fields={options.fields} classifications={options.classifications} value={{ fields: w.fields ?? [], classificationIds: w.classificationIds ?? [] }} onChange={(v) => patch(v)} />
            )}
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

function activeFilterText(f: DashboardFilters, o: Options) {
  const parts = [
    ...Object.entries(f).filter(([k, v]) => typeof v === "string" && v && k !== "fields").map(([k, v]) => `${k}: ${String(v).replace(/_/g, " ")}`),
    ...(f.fields ?? []).map((x) => `${o.fields.find((d) => d.key === x.key)?.label ?? x.key}: ${x.value}`),
    ...(f.classificationIds ?? []).map((id) => o.classifications.find((c) => c.id === id)?.label ?? id),
  ];
  return parts.join(" · ");
}

/** Classification and Additional/Custom field filters (definitions come from Admin → Fields). */
function FieldFilters({ fields, classifications, value, onChange }: { fields: Options["fields"]; classifications: Options["classifications"]; value: { fields: FieldFilter[]; classificationIds: string[] }; onChange: (v: { fields: FieldFilter[]; classificationIds: string[] }) => void }) {
  if (!fields.length && !classifications.length)
    return <p className="mt-2 text-[12px] text-text-3">Classification and custom-field filters appear here once fields are defined in CX settings.</p>;
  return (
    <div className="mt-3 space-y-2">
      {classifications.length > 0 && (
        <Field label="Classification" htmlFor="ff-class">
          <Select id="ff-class" value="" onChange={(e) => e.target.value && onChange({ ...value, classificationIds: [...new Set([...value.classificationIds, e.target.value])] })}>
            <option value="">Add classification…</option>
            {classifications.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
          {value.classificationIds.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {value.classificationIds.map((id) => (
                <button key={id} type="button" onClick={() => onChange({ ...value, classificationIds: value.classificationIds.filter((x) => x !== id) })} className="inline-flex items-center gap-1 rounded bg-surface-3 px-1.5 py-0.5 text-[12px] text-text">
                  {classifications.find((c) => c.id === id)?.label ?? id} <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}
        </Field>
      )}
      {fields.length > 0 && (
        <div>
          <div className="mb-1 text-[12.5px] font-medium text-text">Field filters</div>
          {value.fields.map((f, i) => {
            const def = fields.find((d) => d.key === f.key);
            return (
              <div key={i} className="mb-1.5 flex gap-2">
                <Select aria-label="Field" value={f.key} onChange={(e) => onChange({ ...value, fields: value.fields.map((x, j) => (j === i ? { key: e.target.value, value: "" } : x)) })}>
                  {fields.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </Select>
                {def?.options.length ? (
                  <Select aria-label="Value" value={f.value} onChange={(e) => onChange({ ...value, fields: value.fields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}>
                    <option value="">Choose…</option>
                    {def.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </Select>
                ) : (
                  <Input aria-label="Value" value={f.value} placeholder="Value" onChange={(e) => onChange({ ...value, fields: value.fields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                )}
                <Button size="icon" variant="ghost" aria-label="Remove field filter" onClick={() => onChange({ ...value, fields: value.fields.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            );
          })}
          <Button size="sm" variant="ghost" onClick={() => onChange({ ...value, fields: [...value.fields, { key: fields[0].key, value: "" }] })}><Plus className="h-3.5 w-3.5" /> Field filter</Button>
        </div>
      )}
    </div>
  );
}

function SettingsDialog({ open, onClose, brand, meta, options, shares, onSaved, onDeleted }: { open: boolean; onClose: () => void; brand: string; meta: Meta; options: Options; shares: Share[]; onSaved: () => void; onDeleted: () => void }) {
  const [theme, setTheme] = useState(meta.theme);
  const [filters, setFilters] = useState<DashboardFilters>(meta.filters ?? {});
  const [copied, setCopied] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const setF = (k: "channel" | "priority" | "sentiment" | "status" | "tag", v: string) => setFilters({ ...filters, [k]: v || undefined });

  const [name, setName] = useState(meta.name);
  const [description, setDescription] = useState(meta.description);
  const [shared, setShared] = useState(meta.shared);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title="Dashboard settings"
        error={error}
        footerStart={
          <Button variant="ghost" className="text-critical-ink" disabled={pending} onClick={async () => (await confirm({ title: `Delete the dashboard “${meta.name}”?`, description: "Its widgets are deleted and any public links stop working." })) && start(async () => { const r = await deleteDashboardAction(brand, meta.id); if (r.ok) onDeleted(); else setError(r.error); })}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        }
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={() => start(async () => { const r = await updateDashboardAction(brand, meta.id, { name, description, shared, theme, filters: { ...filters, fields: (filters.fields ?? []).filter((f) => f.value) } }); if (r.ok) { onClose(); onSaved(); } else setError(r.error); })}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name" htmlFor="d-name">
            <Input id="d-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="d-desc">
            <Textarea id="d-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-text">
            <Checkbox checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share with everyone on this brand
            <Badge tone={shared ? "good" : "neutral"}>{shared ? "Shared" : "Private"}</Badge>
          </label>
          <Field label="Theme" htmlFor="d-theme">
            <div className="flex flex-wrap items-center gap-2">
              <Select id="d-theme" value={theme} onChange={(e) => setTheme(e.target.value)} className="w-44">
                {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
              <span className="flex gap-1" aria-hidden>
                {(THEMES.find((t) => t.id === theme)?.colors.length ? THEMES.find((t) => t.id === theme)!.colors : [1, 2, 3, 4, 5, 6].map((i) => `var(--series-${i})`)).map((c, i) => <span key={i} className="h-4 w-4 rounded-sm" style={{ background: c }} />)}
              </span>
            </div>
          </Field>
          <div>
            <div className="mb-1.5 text-[12.5px] font-semibold text-text">Dashboard filters <span className="font-normal text-text-3">(apply to every widget; a widget&apos;s own filter wins)</span></div>
            <div className="grid grid-cols-2 gap-2">
              <Select aria-label="Channel filter" value={filters.channel ?? ""} onChange={(e) => setF("channel", e.target.value)}><option value="">Any channel</option>{options.channels.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
              <Select aria-label="Priority filter" value={filters.priority ?? ""} onChange={(e) => setF("priority", e.target.value)}><option value="">Any priority</option>{["urgent", "high", "normal", "low"].map((c) => <option key={c} value={c}>{c}</option>)}</Select>
              <Select aria-label="Sentiment filter" value={filters.sentiment ?? ""} onChange={(e) => setF("sentiment", e.target.value)}><option value="">Any sentiment</option>{["positive", "neutral", "negative"].map((c) => <option key={c} value={c}>{c}</option>)}</Select>
              <Select aria-label="Tag filter" value={filters.tag ?? ""} onChange={(e) => setF("tag", e.target.value)}><option value="">Any tag</option>{options.tags.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
            </div>
            <FieldFilters fields={options.fields} classifications={options.classifications} value={{ fields: filters.fields ?? [], classificationIds: filters.classificationIds ?? [] }} onChange={(v) => setFilters({ ...filters, ...v })} />
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="mb-1 flex items-center gap-2 text-[12.5px] font-semibold text-text"><Link2 className="h-4 w-4" /> Public links</div>
            <p className="mb-2 text-[12px] text-text-3">Anyone with a link can view this dashboard (read-only, live data) without signing in. Revoke a link to disable it.</p>
            {shares.map((l) => {
              const url = `${origin}/share/${l.token}`;
              return (
                <div key={l.token} className="mb-1.5 flex items-center gap-2">
                  <Input readOnly value={url} aria-label="Share link" className="min-w-0 flex-1 text-[12px]" onFocus={(e) => e.target.select()} />
                  <Button size="sm" onClick={() => navigator.clipboard?.writeText(url).then(() => setCopied(l.token))}>{copied === l.token ? "Copied" : "Copy"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => start(async () => { const r = await revokeShareAction(brand, l.token); if (r.ok) onSaved(); else setError(r.error); })}>Revoke</Button>
                </div>
              );
            })}
            <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await createShareAction(brand, meta.id); if (r.ok) onSaved(); else setError(r.error); })}><Plus className="h-3.5 w-3.5" /> Create public link</Button>
          </div>
        </div>
      </Dialog>
      {confirmDialog}
    </>
  );
}
