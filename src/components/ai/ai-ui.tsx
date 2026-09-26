"use client";

import { Bot, Check, ExternalLink, Minus, Play, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState, useTransition } from "react";
import { addPromptsAction, removePromptsAction, runLiveCheckAction, runReadinessAction, saveCompetitorNamesAction, suggestPromptsAction } from "@/app/(app)/ai-visibility/actions";
import { ENGINES, engineName, type EngineId, type LiveResult } from "@/lib/ai-visibility/meta";
import type { PromptEngineCell, PromptSummary } from "@/lib/ai-visibility/report";
import { dateTimeLabel, displayUrl } from "@/lib/format";
import { SENTIMENT_META } from "@/lib/monitoring/sentiment";
import { cn } from "@/lib/utils";
import { DomainAvatar, Sparkline } from "@/components/seo/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Dialog, Menu } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";

const lines = (s: string) =>
  s
    .split(/\n/)
    .map((x) => x.trim())
    .filter(Boolean);

/** First-run: pick suggested prompts and/or add your own. */
export function PromptSetup({ projectId, suggestions }: { projectId: string; suggestions: string[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set(suggestions));
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const own = lines(custom);
    if (!picked.size && !own.length) return setError("Pick at least one prompt or write your own.");
    setError(null);
    start(async () => {
      if (picked.size) {
        const res = await addPromptsAction(projectId, [...picked], "suggested");
        if (!res.ok) return setError(res.error);
      }
      if (own.length) {
        const res = await addPromptsAction(projectId, own, "custom");
        if (!res.ok) return setError(res.error);
      }
      router.refresh();
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Callout tone="critical">{error}</Callout>}
      <fieldset>
        <legend className="mb-2 text-[12.5px] font-medium text-text-2">Suggested from your brand, category and competitors</legend>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {suggestions.map((s) => (
            <li key={s}>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-2.5 py-2 text-[13px] hover:bg-surface-2">
                <Checkbox
                  className="mt-0.5"
                  checked={picked.has(s)}
                  onChange={() =>
                    setPicked((p) => {
                      const n = new Set(p);
                      if (n.has(s)) n.delete(s);
                      else n.add(s);
                      return n;
                    })
                  }
                />
                <span className="text-text">{s}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <Field label="Your own prompts" htmlFor="ai-custom" hint="One per line — phrase them the way customers ask AI assistants.">
        <Textarea id="ai-custom" value={custom} onChange={(e) => setCustom(e.target.value)} rows={3} className="min-h-0" placeholder="which university in gujarat has the best placements" />
      </Field>
      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <span className="text-[12.5px] text-text-3">{picked.size + lines(custom).length} prompts × 5 AI engines</span>
        <Button type="submit" variant="primary" loading={pending}>
          <Sparkles className="h-4 w-4" /> Start tracking
        </Button>
      </div>
    </form>
  );
}

/** Add prompts, auto-suggest more and edit competitor names. */
export function PromptManager({ projectId, count, competitorNames, namesSource }: { projectId: string; count: number; competitorNames: string[]; namesSource: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [names, setNames] = useState(competitorNames.join("\n"));
  const [msg, setMsg] = useState<{ tone: "good" | "critical"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, success: (d: unknown) => string) =>
    start(async () => {
      const res = await fn();
      setMsg(res.ok ? { tone: "good", text: success(res.data) } : { tone: "critical", text: res.error });
      if (res.ok) router.refresh();
    });
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const list = lines(text);
          if (!list.length) return setMsg({ tone: "critical", text: "Enter at least one prompt." });
          run(
            () => addPromptsAction(projectId, list, "custom"),
            (d) => `Added ${(d as { added: number }).added} prompt(s).`,
          );
          setText("");
        }}
        className="space-y-2"
      >
        <Field label={`Add prompts (${count}/50 tracked)`} htmlFor="ai-add" hint="One per line.">
          <Textarea id="ai-add" value={text} onChange={(e) => setText(e.target.value)} rows={3} className="min-h-0" placeholder="best mba colleges in gujarat" />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" variant="primary" disabled={pending}>
            <Plus className="h-3.5 w-3.5" /> Add prompts
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(
                () => suggestPromptsAction(projectId),
                (d) => `Added ${(d as { added: number }).added} suggested prompt(s).`,
              )
            }
          >
            <Sparkles className="h-3.5 w-3.5" /> Suggest prompts
          </Button>
        </div>
      </form>
      <div className="space-y-2">
        <Field label="Competitor brand names" htmlFor="ai-comp" hint={`${namesSource === "ai" ? "Detected in AI answers, one per line (max 5)." : namesSource === "brand-monitoring" ? "Currently taken from Brand Monitoring; edit to override for AI answers." : "Derived from your competitor domains; edit to use real brand names."} Category leaders fill in when fewer than 4 are tracked.`}>
          <Textarea id="ai-comp" value={names} onChange={(e) => setNames(e.target.value)} rows={4} className="min-h-0" placeholder="Competitor names, one per line" />
        </Field>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(
              () => saveCompetitorNamesAction(projectId, lines(names)),
              () => "Competitor names saved.",
            )
          }
        >
          Save names
        </Button>
      </div>
      {msg && (
        <Callout tone={msg.tone} className="lg:col-span-2">
          {msg.text}
        </Callout>
      )}
    </div>
  );
}

function EngineDot({ cell }: { cell: PromptEngineCell | undefined; engine: EngineId }) {
  const e = ENGINES.find((x) => x.id === cell?.engine);
  if (!cell || !e) return null;
  const label = !cell.present ? `${e.name}: no AI answer shown` : cell.mentioned ? `${e.name}: mentioned at #${cell.position}${cell.cited ? " and cited" : ""}` : `${e.name}: not mentioned${cell.cited ? " (cited as a source)" : ""}`;
  return (
    <Tooltip content={label}>
      <span
        className={cn(
          "inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-[11px] font-semibold",
          !cell.present ? "border border-dashed border-border-strong text-text-3" : cell.mentioned ? (cell.cited ? "bg-good text-white" : "bg-good-soft text-good-ink") : "bg-surface-3 text-text-3",
        )}
        aria-label={label}
      >
        {!cell.present ? <Minus className="h-3 w-3" /> : cell.mentioned ? `#${cell.position}` : <X className="h-3 w-3" />}
      </span>
    </Tooltip>
  );
}

export function EngineLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-2">
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-flex h-4 min-w-5 items-center justify-center rounded bg-good px-1 text-[10px] font-semibold text-white">#1</span> Mentioned &amp; cited
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-flex h-4 min-w-5 items-center justify-center rounded bg-good-soft px-1 text-[10px] font-semibold text-good-ink">#2</span> Mentioned (position)
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-flex h-4 w-5 items-center justify-center rounded bg-surface-3 text-text-3">
          <X className="h-3 w-3" />
        </span>{" "}
        Not mentioned
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-flex h-4 w-5 items-center justify-center rounded border border-dashed border-border-strong text-text-3">
          <Minus className="h-3 w-3" />
        </span>{" "}
        No AI answer
      </li>
    </ul>
  );
}

function highlight(text: string, terms: string[]): ReactNode {
  const list = terms.filter((t) => t.length >= 3).sort((a, b) => b.length - a.length);
  if (!list.length) return text;
  const re = new RegExp(`(${list.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((part, i) =>
    list.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
      <mark key={i} className="rounded bg-brand-soft px-0.5 font-medium text-brand-ink">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function PromptsTable({ projectId, rows, brand }: { projectId: string; rows: PromptSummary[]; brand: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<PromptSummary | null>(null);
  const [engine, setEngine] = useState<EngineId>("chatgpt");
  const [pending, start] = useTransition();
  const remove = (ids: string[], clear?: () => void) =>
    start(async () => {
      await removePromptsAction(projectId, ids);
      clear?.();
      router.refresh();
    });
  const columns: Column<PromptSummary>[] = [
    {
      key: "prompt",
      header: "Prompt",
      render: (r) => (
        <button type="button" className="max-w-[340px] min-w-[200px] text-left text-link hover:underline" onClick={() => (setOpen(r), setEngine(r.latest.find((c) => c.present)?.engine ?? "chatgpt"))}>
          {r.prompt}
          {r.source === "custom" && <span className="ml-1.5 text-[11px] text-text-3">custom</span>}
        </button>
      ),
    },
    {
      key: "engines",
      header: "Today by engine",
      sortable: false,
      info: ENGINES.map((e) => e.name).join(" · "),
      csv: (r) => r.latest.map((c) => `${engineName(c.engine)}: ${!c.present ? "no answer" : c.mentioned ? `#${c.position}${c.cited ? " cited" : ""}` : "not mentioned"}`).join("; "),
      render: (r) => (
        <span className="inline-flex gap-1">
          {ENGINES.map((e) => (
            <EngineDot key={e.id} engine={e.id} cell={r.latest.find((c) => c.engine === e.id)} />
          ))}
        </span>
      ),
    },
    { key: "mentioned", header: "Mentioned (7d)", align: "right", sortValue: (r) => (r.answers ? r.mentioned / r.answers : 0), csv: (r) => `${r.mentioned}/${r.answers}`, render: (r) => <Ratio n={r.mentioned} d={r.answers} /> },
    { key: "cited", header: "Cited (7d)", align: "right", sortValue: (r) => (r.answers ? r.cited / r.answers : 0), csv: (r) => `${r.cited}/${r.answers}`, render: (r) => <Ratio n={r.cited} d={r.answers} /> },
    { key: "avgPosition", header: "Avg. pos.", align: "right", sortValue: (r) => r.avgPosition ?? 99, render: (r) => (r.avgPosition == null ? <span className="text-text-3">n/a</span> : r.avgPosition.toFixed(1)) },
    { key: "sentiment", header: "Sentiment", sortValue: (r) => r.sentiment ?? "", render: (r) => (r.sentiment ? <Badge tone={SENTIMENT_META[r.sentiment].tone}>{SENTIMENT_META[r.sentiment].label}</Badge> : <span className="text-text-3">n/a</span>) },
    { key: "topCompetitor", header: "Top competitor", sortValue: (r) => r.topCompetitor ?? "", render: (r) => <span className="text-text-2">{r.topCompetitor ?? "—"}</span> },
    { key: "spark", header: "30 days", sortable: false, noExport: true, render: (r) => <Sparkline values={r.spark} width={72} height={22} /> },
    {
      key: "actions",
      header: "",
      sortable: false,
      noExport: true,
      render: (r) => (
        <Button size="sm" variant="ghost" aria-label="Remove prompt" title="Remove prompt" disabled={pending} onClick={() => confirm(`Stop tracking “${r.prompt}”?`) && remove([r.id])}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      ),
    },
  ];
  const cell = open?.latest.find((c) => c.engine === engine);
  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        defaultSort={{ key: "mentioned", dir: "desc" }}
        searchable
        searchPlaceholder="Filter prompts"
        searchText={(r) => r.prompt}
        exportName="ai-prompts"
        selectable
        selectionActions={(sel, clear) => (
          <Button size="sm" variant="danger" disabled={pending} onClick={() => confirm(`Stop tracking ${sel.length} prompt(s)?`) && remove(sel.map((s) => s.id), clear)}>
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </Button>
        )}
        toolbar={<EngineLegend />}
      />
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open ? `“${open.prompt}”` : ""} description={open ? `${open.mentioned} of ${open.answers} answers mention ${brand} in the last 7 days · Demo data` : undefined} size="xl">
        {open && (
          <div className="space-y-4">
            <div role="tablist" className="flex flex-wrap gap-1">
              {ENGINES.map((e) => {
                const c = open.latest.find((x) => x.engine === e.id);
                return (
                  <button
                    key={e.id}
                    role="tab"
                    aria-selected={engine === e.id}
                    onClick={() => setEngine(e.id)}
                    className={cn("inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] font-medium", engine === e.id ? "border-brand bg-brand-soft text-brand-ink" : "border-border text-text-2 hover:bg-surface-3")}
                  >
                    {e.name}
                    {c && <EngineDot cell={c} engine={e.id} />}
                  </button>
                );
              })}
            </div>
            {cell && (
              <>
                <div className="flex flex-wrap gap-2">
                  {!cell.present ? (
                    <Badge>No AI answer shown for this query today</Badge>
                  ) : (
                    <>
                      <Badge tone={cell.mentioned ? "good" : "critical"}>{cell.mentioned ? `${brand} mentioned at #${cell.position}` : `${brand} not mentioned`}</Badge>
                      <Badge tone={cell.cited ? "good" : "neutral"}>{cell.cited ? "Your site is cited" : "Your site is not cited"}</Badge>
                      {cell.sentiment && <Badge tone={SENTIMENT_META[cell.sentiment].tone}>{SENTIMENT_META[cell.sentiment].label} framing</Badge>}
                    </>
                  )}
                </div>
                <div className="rounded-lg border border-border bg-surface-2 p-3.5">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold tracking-wide text-text-3 uppercase">
                    <Bot className="h-3.5 w-3.5" /> Illustrative answer · demo
                  </div>
                  <p className="text-[13.5px] leading-relaxed text-text">{highlight(cell.answer, [brand, ...cell.competitors])}</p>
                </div>
                {cell.present && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <div className="mb-1.5 text-[12.5px] font-medium text-text-2">Brands mentioned</div>
                      {cell.competitors.length || cell.mentioned ? (
                        <ul className="space-y-1 text-[13px]">
                          {cell.mentioned && <li className="font-semibold text-text">{brand} (you)</li>}
                          {cell.competitors.map((c) => (
                            <li key={c} className="text-text-2">
                              {c}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[13px] text-text-3">No brands named.</p>
                      )}
                    </div>
                    <div>
                      <div className="mb-1.5 text-[12.5px] font-medium text-text-2">Cited sources</div>
                      <ol className="space-y-1 text-[13px]">
                        {cell.sources.map((s, i) => (
                          <li key={s} className="flex items-center gap-1.5">
                            <span className="w-4 text-[11px] text-text-3">{i + 1}.</span>
                            <DomainAvatar domain={s} size={16} />
                            <span className="truncate text-text">{s}</span>
                          </li>
                        ))}
                      </ol>
                      {cell.citedUrl && (
                        <p className="mt-2 text-[12px] text-text-3">
                          Your cited page: <span className="text-text">{displayUrl(cell.citedUrl)}</span>
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}

export function Ratio({ n, d }: { n: number; d: number }) {
  return (
    <span className="tabular whitespace-nowrap">
      {n}/{d} <span className="text-[11.5px] text-text-3">{d ? Math.round((n / d) * 100) : 0}%</span>
    </span>
  );
}

export function ReadinessButton({ projectId, label = "Run check", variant = "primary" }: { projectId: string; label?: string; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <Button
        variant={variant}
        loading={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await runReadinessAction(projectId);
            if (!res.ok) setError(res.error);
            router.refresh();
          })
        }
      >
        {pending ? null : <ShieldCheck className="h-4 w-4" />} {pending ? "Checking robots.txt & llms.txt…" : label}
      </Button>
      {error && <span className="mt-1 text-[12px] text-critical-ink">{error}</span>}
    </span>
  );
}

export function LiveRunButton({ projectId, engines, enabled, running }: { projectId: string; engines: { id: string; name: string; enabled: boolean }[]; enabled: boolean; running: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const connected = engines.filter((e) => e.enabled);
  const [chosen, setChosen] = useState<Set<string>>(new Set(connected.map((e) => e.id)));
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex items-center gap-2">
        {connected.length > 1 && (
          <Menu
            align="right"
            trigger={() => (
              <Button variant="secondary" disabled={running}>
                Engines ({chosen.size}/{connected.length})
              </Button>
            )}
          >
            {connected.map((e) => (
              <label key={e.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-3">
                <Checkbox
                  checked={chosen.has(e.id)}
                  onChange={() =>
                    setChosen((c) => {
                      const next = new Set(c);
                      if (next.has(e.id)) next.delete(e.id);
                      else next.add(e.id);
                      return next;
                    })
                  }
                />
                {e.name}
              </label>
            ))}
          </Menu>
        )}
        <Button
          variant="primary"
          loading={pending}
          disabled={!enabled || running || chosen.size === 0}
          title={!enabled ? "Connect an AI engine (API key) to enable" : undefined}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await runLiveCheckAction(projectId, [...chosen]);
              if (!res.ok) setError(res.error);
              router.refresh();
            })
          }
        >
          {running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run live check
        </Button>
      </span>
      {error && <span className="text-[12px] text-critical-ink">{error}</span>}
    </span>
  );
}

export function LiveResultsTable({ rows, brand, engines }: { rows: LiveResult[]; brand: string; engines: { id: string; name: string }[] }) {
  const [open, setOpen] = useState<LiveResult | null>(null);
  const [engine, setEngine] = useState<string>("all");
  const nameOf = (id: string) => engines.find((e) => e.id === id)?.name ?? id;
  const present = [...new Set(rows.map((r) => r.engine))];
  const visible = engine === "all" ? rows : rows.filter((r) => r.engine === engine);
  const columns: Column<LiveResult>[] = [
    { key: "engine", header: "Engine", sortValue: (r) => nameOf(r.engine), render: (r) => <span className="text-[12.5px] whitespace-nowrap text-text">{nameOf(r.engine)}</span> },
    { key: "createdAt", header: "Checked", sortValue: (r) => r.createdAt, render: (r) => <span className="text-[12.5px] whitespace-nowrap text-text-2" suppressHydrationWarning>{dateTimeLabel(r.createdAt)}</span> },
    {
      key: "prompt",
      header: "Prompt",
      render: (r) => (
        <button type="button" onClick={() => setOpen(r)} className="max-w-[340px] text-left text-link hover:underline">
          {r.prompt}
        </button>
      ),
    },
    {
      key: "mentioned",
      header: "Mentioned",
      sortValue: (r) => (r.error ? -1 : r.mentioned ? 1 : 0),
      render: (r) => (r.error ? <Badge tone="critical">Error</Badge> : r.mentioned ? <Badge tone="good">#{r.position}</Badge> : <Badge>No</Badge>),
      csv: (r) => (r.error ? "error" : r.mentioned ? `#${r.position}` : "no"),
    },
    { key: "cited", header: "Cited", sortValue: (r) => (r.cited ? 1 : 0), render: (r) => (r.cited ? <Check className="h-4 w-4 text-good-ink" aria-label="Cited" /> : <Minus className="h-4 w-4 text-text-3" aria-label="Not cited" />), csv: (r) => (r.cited ? r.citedUrls.join(" ") : "") },
    { key: "competitors", header: "Competitors named", sortValue: (r) => r.competitors.length, csv: (r) => r.competitors.join("; "), render: (r) => <span className="text-[12.5px] text-text-2">{r.competitors.join(", ") || "—"}</span> },
    { key: "sources", header: "Sources", align: "right", sortValue: (r) => r.sources.length, csv: (r) => r.sources.join("; "), render: (r) => r.sources.length },
    { key: "sentiment", header: "Sentiment", render: (r) => (r.sentiment ? <Badge tone={SENTIMENT_META[r.sentiment].tone}>{SENTIMENT_META[r.sentiment].label}</Badge> : <span className="text-text-3">n/a</span>) },
  ];
  return (
    <>
      <DataTable
        rows={visible}
        columns={columns}
        rowKey={(r) => r.id}
        defaultSort={{ key: "createdAt", dir: "desc" }}
        pageSize={25}
        searchable
        searchPlaceholder="Filter prompts"
        searchText={(r) => r.prompt}
        exportName="ai-live-results"
        toolbar={
          present.length > 1 ? (
            <Segmented size="sm" value={engine} onChange={setEngine} options={[{ value: "all", label: "All engines" }, ...present.map((id) => ({ value: id, label: nameOf(id) }))]} />
          ) : undefined
        }
      />
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open ? `“${open.prompt}”` : ""} description={open ? `${nameOf(open.engine)} (${open.model || "n/a"}) with web search · ${dateTimeLabel(open.createdAt)}` : undefined} size="xl">
        {open &&
          (open.error ? (
            <Callout tone="critical">{open.error}</Callout>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge tone={open.mentioned ? "good" : "critical"}>{open.mentioned ? `${brand} mentioned at #${open.position}` : `${brand} not mentioned`}</Badge>
                <Badge tone={open.cited ? "good" : "neutral"}>{open.cited ? "Your site is cited" : "Your site is not cited"}</Badge>
              </div>
              <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border bg-surface-2 p-3.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-text">{highlight(open.answer, [brand, ...open.competitors])}</div>
              {open.citedUrls.length > 0 && (
                <div>
                  <div className="mb-1 text-[12.5px] font-medium text-text-2">Your cited pages</div>
                  <ul className="space-y-0.5 text-[13px]">
                    {open.citedUrls.map((u) => (
                      <li key={u}>
                        <a href={u} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
                          {displayUrl(u)} <ExternalLink className="inline h-3 w-3" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {open.sources.length > 0 && <p className="text-[12.5px] text-text-3">Sources: {open.sources.join(", ")}</p>}
            </div>
          ))}
      </Dialog>
    </>
  );
}
