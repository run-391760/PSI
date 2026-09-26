"use client";

import { Globe, Plus, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { addTargetsAction, discoverLiveAction, removeTargetsAction } from "@/app/(app)/on-page-checker/actions";
import type { Suggestion } from "@/lib/content/onpage";
import { compact, displayUrl } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { DataSourceBadge } from "@/components/seo/source-badge";

export type TargetRow = { id: string; url: string; keyword: string; origin: string; volume: number };
const ORIGIN: Record<string, string> = { manual: "Manual", csv: "CSV import", ranking: "Ranking data", live: "Live site" };

type AddResult = { added: number; skipped: { input: string; reason: string }[] } | { error: string } | null;

function ResultNote({ result }: { result: AddResult }) {
  if (!result) return null;
  if ("error" in result) return <Callout tone="critical" className="mb-3">{result.error}</Callout>;
  return (
    <Callout tone={result.skipped.length ? "warning" : "good"} className="mb-3" title={`Added ${result.added} page${result.added === 1 ? "" : "s"}${result.skipped.length ? `, skipped ${result.skipped.length}` : ""}`}>
      {result.skipped.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[12.5px]">
          {result.skipped.slice(0, 6).map((s, i) => (
            <li key={i} className="truncate">
              {s.input}: <span className="text-text">{s.reason}</span>
            </li>
          ))}
          {result.skipped.length > 6 && <li>…and {result.skipped.length - 6} more</li>}
        </ul>
      )}
    </Callout>
  );
}

/** Suggestion table with editable keywords and bulk add. */
function SuggestionTable({ rows, onAdd, pending, origin, existing }: { rows: Suggestion[]; onAdd: (pairs: { url: string; keyword: string; origin: "ranking" | "live" }[]) => void; pending: boolean; origin: "ranking" | "live"; existing: Set<string> }) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const kw = (r: Suggestion) => edits[r.url] ?? r.keyword;
  const columns: Column<Suggestion>[] = [
    {
      key: "url",
      header: "Page",
      render: (r) => (
        <a href={r.url} target="_blank" rel="noopener noreferrer" className="block max-w-[260px] truncate text-link hover:underline sm:max-w-[380px]" title={r.url}>
          {displayUrl(r.url)}
        </a>
      ),
    },
    {
      key: "keyword",
      header: "Target keyword",
      sortable: false,
      render: (r) => (
        <Input value={kw(r)} onChange={(e) => setEdits((s) => ({ ...s, [r.url]: e.target.value }))} className="h-7 min-w-44 text-[12.5px]" aria-label={`Keyword for ${r.url}`} />
      ),
      csv: (r) => kw(r),
    },
    { key: "volume", header: "Volume", align: "right", render: (r) => compact(r.volume), info: "Monthly searches (demo data)." },
    { key: "position", header: "Pos.", align: "right", render: (r) => r.position ?? <span className="text-text-3">–</span>, sortValue: (r) => r.position ?? 999 },
    ...(origin === "live"
      ? [{ key: "note", header: "Keyword source", render: (r: Suggestion) => <span className="text-[12px] text-text-3">{r.note}</span> } as Column<Suggestion>]
      : [{ key: "traffic", header: "Traffic", align: "right", render: (r: Suggestion) => compact(r.traffic) } as Column<Suggestion>]),
    {
      key: "state",
      header: "",
      sortable: false,
      noExport: true,
      render: (r) => (existing.has(`${r.url}|${kw(r).trim().toLowerCase()}`) ? <Badge tone="good">Added</Badge> : null),
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.url}
      selectable
      dense
      pageSize={10}
      selectionActions={(sel, clear) => (
        <Button
          size="sm"
          variant="primary"
          loading={pending}
          onClick={() => {
            onAdd(sel.map((r) => ({ url: r.url, keyword: kw(r), origin })));
            clear();
          }}
        >
          <Plus className="h-3.5 w-3.5" /> Add {sel.length} selected
        </Button>
      )}
      emptyText="No suggestions."
    />
  );
}

function parseCsv(text: string) {
  const out: { url: string; keyword: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((p) => p.trim().replace(/^"|"$/g, ""));
    if (parts.length < 2) continue;
    if (/^(url|page|address)$/i.test(parts[0])) continue;
    out.push({ url: parts[0], keyword: parts[1] });
  }
  return out;
}

export function TargetsManager({ projectId, domain, targets, ranking, max }: { projectId: string; domain: string; targets: TargetRow[]; ranking: Suggestion[]; max: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AddResult>(null);
  const [live, setLive] = useState<{ fetchedUrl: string; suggestions: Suggestion[] } | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState([{ url: "", keyword: "" }, { url: "", keyword: "" }, { url: "", keyword: "" }]);
  const [csv, setCsv] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const existing = useMemo(() => new Set(targets.map((t) => `${t.url}|${t.keyword}`)), [targets]);

  const add = (pairs: { url: string; keyword: string; origin: "manual" | "csv" | "ranking" | "live" }[], after?: () => void) =>
    start(async () => {
      const clean = pairs.filter((p) => p.url.trim() || p.keyword.trim());
      if (!clean.length) return setResult({ error: "Enter at least one URL and keyword." });
      const missing = clean.find((p) => !p.url.trim() || !p.keyword.trim());
      if (missing) return setResult({ error: "Every row needs both a URL and a keyword." });
      const res = await addTargetsAction(projectId, clean);
      setResult(res.ok ? res.data : { error: res.error });
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });

  const scan = async () => {
    setScanning(true);
    setLiveError(null);
    const res = await discoverLiveAction(projectId);
    setScanning(false);
    if (res.ok) setLive(res.data);
    else setLiveError(res.error);
  };

  const targetColumns: Column<TargetRow>[] = [
    {
      key: "url",
      header: "Page",
      render: (r) => (
        <a href={r.url} target="_blank" rel="noopener noreferrer" className="block max-w-[280px] truncate text-link hover:underline sm:max-w-[460px]" title={r.url}>
          {displayUrl(r.url)}
        </a>
      ),
    },
    { key: "keyword", header: "Target keyword", render: (r) => <span className="font-medium text-text">{r.keyword}</span> },
    { key: "volume", header: "Volume", align: "right", render: (r) => compact(r.volume) },
    { key: "origin", header: "Added from", render: (r) => <Badge>{ORIGIN[r.origin] ?? r.origin}</Badge>, csv: (r) => ORIGIN[r.origin] ?? r.origin },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Pages and target keywords" description={`${targets.length} of ${max} pairs. Each page is fetched live and compared with the top 10 for its keyword.`} />
        <DataTable
          rows={targets}
          columns={targetColumns}
          rowKey={(r) => r.id}
          selectable
          searchable
          searchPlaceholder="Filter pages"
          exportName={`on-page-targets-${domain}`}
          pageSize={10}
          emptyText="No pages yet — add some below."
          selectionActions={(sel, clear) => (
            <Button
              size="sm"
              variant="danger"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const res = await removeTargetsAction(projectId, sel.map((s) => s.id));
                  if (!res.ok) setResult({ error: res.error });
                  clear();
                  router.refresh();
                })
              }
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove {sel.length}
            </Button>
          )}
        />
      </Card>

      <Card>
        <CardHeader title="Add pages" description="Pick suggestions, discover pages on your live site, or add your own pairs." />
        <div className="px-4">
          <ResultNote result={result} />
        </div>
        <Tabs
          className="min-w-0 [&>[role=tablist]]:scroll-thin [&>[role=tablist]]:overflow-x-auto"
          tabs={[
            {
              id: "live",
              label: "Discover on live site",
              content: (
                <div className="pt-3">
                  <div className="flex flex-wrap items-center gap-3 px-4 pb-3">
                    <Button onClick={scan} loading={scanning} variant={live ? "secondary" : "primary"}>
                      <Globe className="h-4 w-4" /> {live ? "Scan again" : `Scan ${domain}`}
                    </Button>
                    <p className="max-w-xl text-[12.5px] text-text-3">
                      Fetches your homepage (respecting robots.txt), lists the pages it links to and pairs each with the best-matching keyword. You can edit keywords before adding.
                    </p>
                  </div>
                  {liveError && <Callout tone="critical" className="mx-4 mb-3">{liveError}</Callout>}
                  {live && (
                    <>
                      <div className="flex flex-wrap items-center gap-2 px-4 pb-2 text-[12.5px] text-text-2">
                        <DataSourceBadge source="crawler" fetchedAt={new Date().toISOString()} />
                        <span>
                          {live.suggestions.length} pages found on {displayUrl(live.fetchedUrl)} · volumes are demo data
                        </span>
                      </div>
                      <SuggestionTable rows={live.suggestions} origin="live" existing={existing} pending={pending} onAdd={(p) => add(p)} />
                    </>
                  )}
                </div>
              ),
            },
            {
              id: "ranking",
              label: "From ranking data",
              content: (
                <div className="pt-3">
                  <div className="flex flex-wrap items-center gap-2 px-4 pb-2 text-[12.5px] text-text-2">
                    <DataSourceBadge source="demo" />
                    <span>Top pages and their best keyword from Organic Research. Demo URLs may not exist on your live site.</span>
                  </div>
                  <SuggestionTable rows={ranking} origin="ranking" existing={existing} pending={pending} onAdd={(p) => add(p)} />
                </div>
              ),
            },
            {
              id: "manual",
              label: "Add manually",
              content: (
                <CardBody className="pt-4">
                  <div className="space-y-2">
                    {manual.map((row, i) => (
                      <div key={i} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_auto]">
                        <Input
                          placeholder={`https://${domain}/page`}
                          value={row.url}
                          aria-label={`URL ${i + 1}`}
                          onChange={(e) => setManual((m) => m.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                        />
                        <Input placeholder="target keyword" value={row.keyword} aria-label={`Keyword ${i + 1}`} onChange={(e) => setManual((m) => m.map((x, j) => (j === i ? { ...x, keyword: e.target.value } : x)))} />
                        <Button variant="ghost" size="icon" aria-label="Remove row" onClick={() => setManual((m) => (m.length > 1 ? m.filter((_, j) => j !== i) : [{ url: "", keyword: "" }]))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setManual((m) => [...m, { url: "", keyword: "" }])}>
                      <Plus className="h-3.5 w-3.5" /> Add row
                    </Button>
                    <Button size="sm" variant="primary" loading={pending} onClick={() => add(manual.map((m) => ({ ...m, origin: "manual" as const })), () => setManual([{ url: "", keyword: "" }]))}>
                      Add pages
                    </Button>
                  </div>
                </CardBody>
              ),
            },
            {
              id: "csv",
              label: "Import CSV",
              content: (
                <CardBody className="pt-4">
                  <Field label="One page per line: URL, keyword" hint="Comma, semicolon or tab separated. A header row (url,keyword) is ignored. Up to 200 rows." htmlFor="csv-in">
                    <Textarea id="csv-in" rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={`https://${domain}/pricing, ${domain.split(".")[0]} pricing\nhttps://${domain}/blog/guide, seo guide`} className="font-mono text-[12.5px]" />
                  </Field>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".csv,.txt,.tsv,text/csv,text/plain"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        if (f.size > 1_000_000) return setResult({ error: "CSV files must be under 1 MB." });
                        f.text().then(setCsv);
                        e.target.value = "";
                      }}
                    />
                    <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
                      <Upload className="h-3.5 w-3.5" /> Choose file
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      loading={pending}
                      onClick={() => {
                        const rows = parseCsv(csv);
                        if (!rows.length) return setResult({ error: "No “URL, keyword” rows found." });
                        add(rows.map((r) => ({ ...r, origin: "csv" as const })), () => setCsv(""));
                      }}
                    >
                      Import {parseCsv(csv).length || ""} rows
                    </Button>
                  </div>
                </CardBody>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
