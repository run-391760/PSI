"use client";

import Papa from "papaparse";
import { Copy as CopyIcon, FileUp, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, Wand2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import { addKeywordsAction, createListAction, createListFromSeedAction, deleteListAction, refreshListAction, removeKeywordsAction, renameListAction } from "@/app/(app)/keyword-strategy/actions";
import { DATABASES } from "@/lib/domain";
import { dateLabel, money } from "@/lib/format";
import { parseKeywordInput } from "@/lib/keywords/text";
import type { GscKwStat } from "@/lib/keywords/gsc-map";
import { TEXT_INTENT_NOTE } from "@/lib/keywords/intent";
import type { ListItem } from "@/lib/keywords/types";
import { compact } from "@/lib/format";
import { INTENT_META, IntentBadges, KdBadge, KeywordLink, SerpFeatureIcons, TrendBars, featureLabel } from "@/components/seo/badges";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Dialog, Menu, MenuItem } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { AddToListDialog } from "./add-to-list";

const MAX = 2000;

function DbSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {DATABASES.map((d) => (
        <option key={d.code} value={d.code}>
          {d.flag} {d.name}
        </option>
      ))}
    </Select>
  );
}

/** "New list" button + dialog (name, database, optional keywords). */
export function NewListButton({ variant = "primary", label = "New list" }: { variant?: "primary" | "secondary"; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [db, setDb] = useState("US");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const parsed = useMemo(() => parseKeywordInput(text, MAX), [text]);
  const close = () => {
    setOpen(false);
    setError(null);
  };
  const submit = () => {
    if (pending || !name.trim()) return;
    setError(null);
    start(async () => {
      const res = await createListAction({ name, db, keywords: parsed.keywords, from: "manual" });
      if (!res.ok) return setError(res.error);
      setOpen(false);
      setName("");
      setText("");
      router.push(`/keyword-strategy?list=${res.data.id}`);
      router.refresh();
    });
  };
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> {label}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Create keyword list"
        description="Lists keep keywords with their metrics so you can cluster them into topics and pages."
        dismissible={!pending}
        error={error}
        onSubmit={submit}
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={pending} disabled={pending || !name.trim()}>
              Create list
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
            <Field label="Name" htmlFor="nl-name">
              <Input id="nl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Running shoes blog" maxLength={80} autoFocus required />
            </Field>
            <Field label="Database" htmlFor="nl-db">
              <DbSelect id="nl-db" value={db} onChange={setDb} />
            </Field>
          </div>
          <Field label="Keywords (optional)" htmlFor="nl-kw" hint={`${parsed.keywords.length.toLocaleString()} keywords${parsed.overflow ? ` · ${parsed.overflow} over the ${MAX.toLocaleString()} limit` : ""}. One per line or comma separated.`}>
            <Textarea id="nl-kw" value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={"running shoes\ntrail running shoes"} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}

/** Create a list from the top keyword ideas of a seed keyword. */
export function SeedListForm() {
  const router = useRouter();
  const [seed, setSeed] = useState("");
  const [db, setDb] = useState("US");
  const [size, setSize] = useState("100");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createListFromSeedAction({ seed, db, size: Number(size) });
      if (!res.ok) return setError(res.error);
      router.push(`/keyword-strategy?list=${res.data.id}&view=clusters`);
      router.refresh();
    });
  };
  return (
    <form onSubmit={submit} className="space-y-2.5">
      {error && <Callout tone="critical">{error}</Callout>}
      <Field label="Seed keyword" htmlFor="seed-kw">
        <Input id="seed-kw" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="e.g. running shoes" maxLength={80} required />
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Database" htmlFor="seed-db">
          <DbSelect id="seed-db" value={db} onChange={setDb} />
        </Field>
        <Field label="Keywords" htmlFor="seed-size">
          <Select id="seed-size" value={size} onChange={(e) => setSize(e.target.value)}>
            {["25", "50", "100", "200", "500"].map((n) => (
              <option key={n} value={n}>
                Top {n} ideas
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Button type="submit" variant="primary" loading={pending} disabled={!seed.trim()} className="w-full">
        <Wand2 className="h-4 w-4" /> Build list and clusters
      </Button>
    </form>
  );
}

/** Add keywords to a list: manual entry or CSV upload. */
function AddKeywordsDialog({ open, onClose, listId }: { open: boolean; onClose: () => void; listId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"manual" | "csv">("manual");
  const [text, setText] = useState("");
  const [csv, setCsv] = useState<{ name: string; keywords: string[]; column: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const manual = useMemo(() => parseKeywordInput(text, MAX), [text]);
  const keywords = mode === "manual" ? manual.keywords : (csv?.keywords ?? []);

  useEffect(() => {
    if (open) {
      setResult(null);
      setError(null);
    }
  }, [open]);

  const onFile = (file: File | undefined) => {
    setError(null);
    setCsv(null);
    if (!file) return;
    if (file.size > 2_000_000) return setError("The file is larger than 2 MB. Split it into smaller files.");
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (res) => {
        const rows = (res.data as string[][]).filter((r) => r.some((c) => String(c).trim()));
        if (!rows.length) return setError("The file is empty.");
        const header = rows[0].map((c) => String(c).trim().toLowerCase());
        let col = header.findIndex((h) => ["keyword", "keywords", "query", "search term", "term", "phrase"].includes(h));
        const hasHeader = col >= 0 || header.some((h) => /volume|kd|cpc|intent|position/.test(h));
        if (col < 0) col = 0;
        const values = rows.slice(hasHeader ? 1 : 0).map((r) => String(r[col] ?? ""));
        const parsed = parseKeywordInput(values.join("\n"), MAX);
        if (!parsed.keywords.length) return setError("No keywords found in the file.");
        setCsv({ name: file.name, keywords: parsed.keywords, column: hasHeader ? rows[0][col] : `column ${col + 1}` });
        if (parsed.overflow) setError(`Only the first ${MAX.toLocaleString()} keywords will be imported (${parsed.overflow.toLocaleString()} skipped).`);
      },
      error: (err) => setError(`Could not read the file: ${err.message}`),
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await addKeywordsAction(listId, keywords, mode === "csv" ? "csv" : "manual");
      if (!res.ok) return setError(res.error);
      setResult(`${res.data.added.toLocaleString()} keywords added${res.data.skipped ? `, ${res.data.skipped.toLocaleString()} already in the list` : ""}.`);
      setText("");
      setCsv(null);
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add keywords"
      description="Metrics are fetched for the list's database when keywords are added."
      size="lg"
      dismissible={!pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {result ? "Done" : "Cancel"}
          </Button>
          <Button variant="primary" type="submit" form="add-kw-form" loading={pending} disabled={pending || !keywords.length}>
            Add {keywords.length ? keywords.length.toLocaleString() : ""} keyword{keywords.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <form id="add-kw-form" onSubmit={submit} className="space-y-3">
        {result && <Callout tone="good">{result}</Callout>}
        {error && <Callout tone="warning">{error}</Callout>}
        <Segmented
          options={[
            { value: "manual", label: "Enter manually" },
            { value: "csv", label: "Upload CSV" },
          ]}
          value={mode}
          onChange={setMode}
          size="md"
        />
        {mode === "manual" ? (
          <Field label="Keywords" htmlFor="add-kw" hint={`${manual.keywords.length.toLocaleString()} unique keywords · one per line or comma separated · up to ${MAX.toLocaleString()}`}>
            <Textarea id="add-kw" value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={"best running shoes\nrunning shoes for flat feet"} autoFocus />
          </Field>
        ) : (
          <div>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong bg-surface-2 px-4 py-8 text-center hover:bg-surface-3">
              <FileUp className="h-5 w-5 text-text-3" />
              <span className="text-[13px] font-medium text-text">{csv ? csv.name : "Choose a CSV file"}</span>
              <span className="text-[12px] text-text-3">Uses the “Keyword” column if present, otherwise the first column. Exports from other tools work.</span>
              <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            {csv && (
              <p className="mt-2 text-[12.5px] text-text-2">
                {csv.keywords.length.toLocaleString()} keywords from “{csv.column}”: {csv.keywords.slice(0, 6).join(", ")}
                {csv.keywords.length > 6 ? "…" : ""}
              </p>
            )}
          </div>
        )}
      </form>
    </Dialog>
  );
}

/** Header actions for an open list. */
export function ListActions({ listId, name }: { listId: string; name: string }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newName, setNewName] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [refreshing, startRefresh] = useTransition();
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
      <Button variant="primary" onClick={() => setAdding(true)}>
        <Plus className="h-4 w-4" /> Add keywords
      </Button>
      <Button loading={refreshing} onClick={() => startRefresh(async () => void (await refreshListAction(listId), router.refresh()))} title="Re-fetch volume, KD, CPC and intent for every keyword">
        {!refreshing && <RefreshCw className="h-4 w-4" />} Refresh metrics
      </Button>
      <Menu
        align="right"
        trigger={() => (
          <Button variant="secondary" size="icon" aria-label="More list actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              icon={<Pencil className="h-3.5 w-3.5" />}
              onClick={() => {
                close();
                setNewName(name);
                setRenaming(true);
              }}
            >
              Rename list
            </MenuItem>
            <MenuItem
              danger
              icon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={() => {
                close();
                setDeleting(true);
              }}
            >
              Delete list
            </MenuItem>
          </>
        )}
      </Menu>
      <AddKeywordsDialog open={adding} onClose={() => setAdding(false)} listId={listId} />
      <Dialog
        open={renaming}
        onClose={() => (setRenaming(false), setError(null))}
        title="Rename list"
        size="sm"
        dismissible={!pending}
        error={error}
        onSubmit={() => newName.trim() && !pending && run(() => renameListAction(listId, newName), () => setRenaming(false))}
        footer={
          <>
            <Button variant="ghost" onClick={() => (setRenaming(false), setError(null))} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending} disabled={pending || !newName.trim()}>
              Save
            </Button>
          </>
        }
      >
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} aria-label="List name" autoFocus />
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onCancel={() => (setDeleting(false), setError(null))}
        onConfirm={() =>
          start(async () => {
            setError(null);
            const res = await deleteListAction(listId);
            if (!res.ok) return setError(res.error);
            setDeleting(false);
            router.push("/keyword-strategy");
            router.refresh();
          })
        }
        title="Delete this list?"
        description={`“${name}” and all its keywords will be removed. This cannot be undone. Keywords you track in Position Tracking are not affected.`}
        confirmLabel="Delete list"
        busy={pending}
        error={error}
      />
    </>
  );
}

/** Keywords of a list: metrics table with remove / copy to another list. */
export function ListKeywordsTable({ listId, listName, items, db, metrics = true, gsc }: { listId: string; listName: string; items: ListItem[]; db: string; metrics?: boolean; gsc?: Record<string, GscKwStat> }) {
  const router = useRouter();
  const [copy, setCopy] = useState<string[] | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const rows = items;
  return (
    <div>
      {error && <Callout tone="critical" className="mx-4 mb-3">{error}</Callout>}
      <SelectionWrapper
        rows={rows}
        db={db}
        metrics={metrics}
        gsc={gsc}
        exportName={`keyword-list_${listName.replace(/\s+/g, "-")}_${db}`}
        onRemove={(keywords) =>
          start(async () => {
            const res = await removeKeywordsAction(listId, keywords);
            if (!res.ok) return setError(res.error);
            router.refresh();
          })
        }
        onCopy={setCopy}
        pending={pending}
      />
      <AddToListDialog open={copy !== null} onClose={() => setCopy(null)} keywords={copy ?? []} db={db} defaultName={`${listName} (copy)`} from="keyword-strategy" />
    </div>
  );
}

type Row = ListItem;
const na = <span className="text-text-3">n/a</span>;

function SelectionWrapper({ rows, db, exportName, onRemove, onCopy, pending, metrics, gsc }: { rows: Row[]; db: string; exportName: string; onRemove: (k: string[]) => void; onCopy: (k: string[]) => void; pending: boolean; metrics: boolean; gsc?: Record<string, GscKwStat> }) {
  const columns = useMemo<Column<Row>[]>(
    () => [
      { key: "keyword", header: "Keyword", sortValue: (r) => r.keyword, render: (r) => <KeywordLink keyword={r.keyword} db={db} className="whitespace-nowrap" /> },
      ...(gsc
        ? ([
            { key: "gscImpr", header: "Your impr.", align: "right", info: "Impressions of your linked sites (Search Console, last 3 months).", sortValue: (r) => gsc[r.keyword]?.impressions ?? null, render: (r) => (gsc[r.keyword] ? compact(gsc[r.keyword].impressions) : na), csv: (r) => gsc[r.keyword]?.impressions ?? "" },
            { key: "gscClicks", header: "Your clicks", align: "right", sortValue: (r) => gsc[r.keyword]?.clicks ?? null, render: (r) => (gsc[r.keyword] ? compact(gsc[r.keyword].clicks) : na), csv: (r) => gsc[r.keyword]?.clicks ?? "" },
            { key: "gscPos", header: "Your pos.", align: "right", sortValue: (r) => gsc[r.keyword]?.position ?? null, render: (r) => (gsc[r.keyword] ? gsc[r.keyword].position.toFixed(1) : na), csv: (r) => gsc[r.keyword]?.position ?? "" },
          ] as Column<Row>[])
        : []),
      { key: "intent", header: metrics ? "Intent" : "Intent (text)", info: metrics ? undefined : TEXT_INTENT_NOTE, sortValue: (r) => r.intents[0] ?? "", render: (r) => (r.intents.length ? <IntentBadges intents={r.intents} /> : na), csv: (r) => r.intents.map((i) => INTENT_META[i].label).join("; ") },
      { key: "volume", header: "Volume", align: "right", sortValue: (r) => r.volume, render: (r) => (r.volume == null ? na : r.volume.toLocaleString()) },
      { key: "trend", header: "Trend", sortable: false, render: (r) => (r.trend.length ? <TrendBars values={r.trend} width={56} height={16} /> : na), csv: (r) => r.trend.join(" ") },
      { key: "kd", header: "KD %", align: "right", sortValue: (r) => r.kd, render: (r) => <KdBadge kd={r.kd} /> },
      { key: "cpc", header: "CPC (USD)", align: "right", sortValue: (r) => r.cpc, render: (r) => (r.cpc == null ? na : money(r.cpc)) },
      { key: "competition", header: "Com.", align: "right", sortValue: (r) => r.competition, render: (r) => (r.competition == null ? na : r.competition.toFixed(2)) },
      { key: "features", header: "SERP features", sortValue: (r) => r.features.length, render: (r) => <SerpFeatureIcons features={r.features} max={4} />, csv: (r) => r.features.map(featureLabel).join("; ") },
      { key: "addedAt", header: "Added", align: "right", sortValue: (r) => r.addedAt, render: (r) => <span className="text-[12px] whitespace-nowrap text-text-3">{dateLabel(r.addedAt)}</span>, csv: (r) => r.addedAt.slice(0, 10) },
    ],
    [db, metrics, gsc],
  );
  const visible = metrics ? columns : columns.filter((c) => !["trend", "competition", "features"].includes(c.key));
  return (
    <DataTable
      rows={rows}
      columns={visible}
      rowKey={(r) => r.keyword}
      defaultSort={metrics ? { key: "volume", dir: "desc" } : gsc ? { key: "gscImpr", dir: "desc" } : undefined}
      pageSize={50}
      searchable
      searchText={(r) => r.keyword}
      selectable
      exportName={exportName}
      emptyText="This list is empty. Add keywords manually, from a CSV file or from the Keyword Magic Tool."
      selectionActions={(sel, clear) => (
        <>
          <Button size="sm" variant="ghost" onClick={() => onCopy(sel.map((r) => r.keyword))}>
            <CopyIcon className="h-3.5 w-3.5" /> Copy to list
          </Button>
          <Button
            size="sm"
            variant="danger"
            loading={pending}
            onClick={() => {
              onRemove(sel.map((r) => r.keyword));
              clear();
            }}
          >
            <X className="h-3.5 w-3.5" /> Remove
          </Button>
        </>
      )}
    />
  );
}

/** Opens the add-to-list dialog for keywords passed via ?import= (links from other tools). */
export function ImportOnLoad({ keywords, db, name, overflow }: { keywords: string[]; db: string; name?: string; overflow: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  return (
    <>
      {overflow > 0 && (
        <Callout tone="warning" className="mb-4">
          Only the first {keywords.length.toLocaleString()} keywords can be imported at once; {overflow.toLocaleString()} were skipped.
        </Callout>
      )}
      <AddToListDialog
        open={open}
        onClose={() => {
          setOpen(false);
          router.replace("/keyword-strategy");
        }}
        keywords={keywords}
        db={db}
        defaultName={name || "Imported keywords"}
        from="import"
        navigate
      />
    </>
  );
}
