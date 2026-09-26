"use client";

import { Eraser, Layers, ListPlus, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { analyzeBulkAction, type BulkResult } from "@/app/(app)/bulk-analysis/actions";
import type { BulkRow } from "@/lib/backlinks/types";
import { compact, pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BarChart } from "@/components/charts/bar-chart";
import { AsBadge } from "@/components/seo/badges";
import { DataSourceBadge } from "@/components/seo/source-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Textarea } from "@/components/ui/input";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { BlDomainLink } from "./bits";
import { ExportButton, useCsvExport } from "./table-tools";

const LIMIT = 200;
const STORAGE_KEY = "synapse.bulk-analysis.input";
const EXAMPLE = ["nike.com", "adidas.com", "puma.com", "zara.com", "hm.com", "uniqlo.com", "asos.com", "shop.nike.com", "https://www.adidas.com/us/ultraboost", "blog.hubspot.com", "https://www.healthline.com/nutrition/intermittent-fasting-guide", "not a domain"].join("\n");

const EXAMPLE_LISTS = [
  { label: "Fashion retailers", items: ["nike.com", "adidas.com", "zara.com", "hm.com", "uniqlo.com", "asos.com", "shein.com", "nordstrom.com"] },
  { label: "SEO tools", items: ["semrush.com", "ahrefs.com", "moz.com", "similarweb.com", "yoast.com", "backlinko.com"] },
  { label: "Online learning", items: ["coursera.org", "udemy.com", "edx.org", "khanacademy.org", "upgrad.com", "simplilearn.com", "paruluniversity.ac.in"] },
];

const countLines = (text: string) =>
  text
    .split(/\r?\n/)
    .flatMap((l) => l.split(","))
    .map((s) => s.trim())
    .filter(Boolean).length;

const KIND_LABEL: Record<BulkRow["kind"], string> = { domain: "Root domain", subdomain: "Subdomain", url: "URL" };
const num = (v: number | null) => (v == null ? "n/a" : compact(v));

function Split({ a, b, labelA, labelB }: { a: number | null; b: number | null; labelA: string; labelB: string }) {
  if (a == null || b == null) return <span className="text-text-3">n/a</span>;
  return (
    <div className="ml-auto w-28" title={`${labelA} ${pct(a)} · ${labelB} ${pct(b)}`}>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-3">
        <span style={{ width: `${a}%`, background: "var(--series-1)" }} />
        <span style={{ width: `${b}%`, background: "var(--series-2)" }} />
      </div>
      <div className="mt-1 flex justify-between text-[11.5px] text-text-2">
        <span className="tabular">{pct(a, 0)}</span>
        <span className="tabular text-text-3">{pct(b, 0)}</span>
      </div>
    </div>
  );
}

const columns: Column<BulkRow>[] = [
  {
    key: "target",
    header: "Target",
    render: (r) => (
      <div className="max-w-[340px] min-w-[180px]">
        {r.kind === "url" ? (
          <a href={`https://${r.target}`} target="_blank" rel="noopener noreferrer" className="block truncate text-link hover:underline" title={r.target}>
            {r.target}
          </a>
        ) : r.kind === "subdomain" ? (
          <span className="block truncate text-text">{r.target}</span>
        ) : (
          <BlDomainLink domain={r.target} />
        )}
        <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-text-3">
          <Badge className="h-4 px-1 text-[10.5px]">{KIND_LABEL[r.kind]}</Badge>
          {r.kind !== "domain" && (
            <Link href={`/backlink-analytics?q=${encodeURIComponent(r.domain)}`} className="hover:text-link">
              {r.domain}
            </Link>
          )}
        </div>
      </div>
    ),
  },
  { key: "authorityScore", header: "AS", align: "right", info: "Authority Score of the root domain.", render: (r) => (r.authorityScore == null ? "n/a" : <AsBadge score={r.authorityScore} />) },
  { key: "referringDomains", header: "Ref. domains", align: "right", render: (r) => num(r.referringDomains) },
  { key: "backlinks", header: "Backlinks", align: "right", render: (r) => num(r.backlinks) },
  { key: "followPct", header: "Follow / Nofollow", align: "right", render: (r) => <Split a={r.followPct} b={r.nofollowPct} labelA="Follow" labelB="Nofollow" /> },
  { key: "textPct", header: "Text / Image", align: "right", render: (r) => <Split a={r.textPct} b={r.imagePct} labelA="Text" labelB="Image" /> },
  {
    key: "newRd30",
    header: "Ref. domains 30d",
    align: "right",
    info: "New and lost referring domains in the last 30 days.",
    render: (r) =>
      r.newRd30 == null ? (
        <span className="text-text-3">n/a</span>
      ) : (
        <span className="tabular whitespace-nowrap">
          <span className="text-good-ink">+{compact(r.newRd30)}</span> <span className="text-critical-ink">−{compact(r.lostRd30 ?? 0)}</span>
        </span>
      ),
  },
  {
    key: "newBl30",
    header: "Backlinks 30d",
    align: "right",
    info: "New and lost backlinks in the last 30 days.",
    render: (r) =>
      r.newBl30 == null ? (
        <span className="text-text-3">n/a</span>
      ) : (
        <span className="tabular whitespace-nowrap">
          <span className="text-good-ink">+{compact(r.newBl30)}</span> <span className="text-critical-ink">−{compact(r.lostBl30 ?? 0)}</span>
        </span>
      ),
  },
  { key: "referringIps", header: "Ref. IPs", align: "right", render: (r) => num(r.referringIps) },
];

export function BulkAnalysis({ initial, autoRun }: { initial?: string; autoRun?: boolean }) {
  const [text, setText] = useState(initial ?? "");
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ran = useRef(false);
  const count = useMemo(() => countLines(text), [text]);
  const over = count > LIMIT;

  const run = (value = text) => {
    setError(null);
    start(async () => {
      const res = await analyzeBulkAction(value);
      if (!res.ok) {
        setError(res.error);
        setResult(null);
        return;
      }
      setResult(res.data);
    });
  };

  useEffect(() => {
    if (initial) {
      if (autoRun && !ran.current) {
        ran.current = true;
        run(initial);
      }
      return;
    }
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setText(saved);
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, text);
    } catch {
      /* storage unavailable */
    }
  }, [text]);

  const rows = result?.rows ?? [];
  const { onRowsChange, exportCsv } = useCsvExport<BulkRow>(
    "bulk-backlink-analysis",
    ["Target", "Type", "Root domain", "Authority Score", "Referring domains", "Backlinks", "Follow %", "Nofollow %", "Text %", "Image %", "New ref. domains 30d", "Lost ref. domains 30d", "New backlinks 30d", "Lost backlinks 30d", "Referring IPs"],
    (r) => [r.target, KIND_LABEL[r.kind], r.domain, r.authorityScore, r.referringDomains, r.backlinks, r.followPct, r.nofollowPct, r.textPct, r.imagePct, r.newRd30, r.lostRd30, r.newBl30, r.lostBl30, r.referringIps],
  );
  const withAs = rows.filter((r) => r.authorityScore != null);
  const avgAs = withAs.length ? Math.round(withAs.reduce((s, r) => s + (r.authorityScore ?? 0), 0) / withAs.length) : null;
  const top = [...rows].sort((a, b) => (b.referringDomains ?? 0) - (a.referringDomains ?? 0)).slice(0, 12);

  return (
    <>
      <Card className="mb-4">
        <CardHeader title="Targets" description={`One domain, subdomain or URL per line — up to ${LIMIT}.`} />
        <CardBody>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!over && count) run();
            }}
          >
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder={"example.com\nblog.example.com\nhttps://example.com/page"}
              className="font-mono text-[12.5px]"
              aria-label="Domains or URLs, one per line"
              aria-invalid={over}
            />
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" loading={pending} disabled={!count || over}>
                <Play className="h-3.5 w-3.5" /> Analyze
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setText(EXAMPLE)}>
                <ListPlus className="h-3.5 w-3.5" /> Load example
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setText("");
                  setResult(null);
                  setError(null);
                }}
                disabled={!text}
              >
                <Eraser className="h-3.5 w-3.5" /> Clear
              </Button>
              <span className={cn("ml-auto text-[12.5px] tabular", over ? "font-medium text-critical-ink" : "text-text-3")}>
                {count} / {LIMIT} targets{over ? ` — remove ${count - LIMIT}` : ""}
              </span>
            </div>
          </form>
        </CardBody>
      </Card>

      {!result && !pending && !error && (
        <Card className="mb-4">
          <EmptyState
            icon={<Layers className="h-5 w-5" />}
            title="Compare many backlink profiles at once"
            description="Paste your list above, or run one of these example lists:"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {EXAMPLE_LISTS.map((l) => (
                  <Button
                    key={l.label}
                    size="sm"
                    onClick={() => {
                      const value = l.items.join("\n");
                      setText(value);
                      run(value);
                    }}
                  >
                    {l.label} <span className="text-text-3">· {l.items.length}</span>
                  </Button>
                ))}
              </div>
            }
          />
        </Card>
      )}

      {error && (
        <Callout tone="critical" className="mb-4">
          {error}
        </Callout>
      )}

      {result && (
        <>
          {(result.invalid.length > 0 || result.duplicates > 0) && (
            <Callout tone="warning" className="mb-4" title={result.invalid.length ? `${result.invalid.length} line${result.invalid.length === 1 ? "" : "s"} skipped` : undefined}>
              {result.invalid.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-[12.5px]">
                  {result.invalid.slice(0, 12).map((i) => (
                    <li key={`${i.line}:${i.value}`}>
                      Line {i.line}: <code className="rounded bg-surface-3 px-1">{i.value}</code> — {i.reason}
                    </li>
                  ))}
                  {result.invalid.length > 12 && <li>…and {result.invalid.length - 12} more</li>}
                </ul>
              )}
              {result.duplicates > 0 && <div className="mt-1 text-[12.5px]">{result.duplicates} duplicate target{result.duplicates === 1 ? "" : "s"} merged.</div>}
            </Callout>
          )}

          <Card className="mb-4">
            <MetricStrip>
              <Metric label="Targets analyzed" value={rows.length} sub={`in ${result.ms < 1000 ? `${result.ms} ms` : `${(result.ms / 1000).toFixed(1)} s`}`} />
              <Metric label="Average Authority Score" value={avgAs ?? "n/a"} />
              <Metric label="Referring domains (sum)" value={compact(rows.reduce((s, r) => s + (r.referringDomains ?? 0), 0))} />
              <Metric label="Backlinks (sum)" value={compact(rows.reduce((s, r) => s + (r.backlinks ?? 0), 0))} />
              <Metric label="Skipped lines" value={result.invalid.length} sub={result.duplicates ? `${result.duplicates} duplicates merged` : "No duplicates"}>
                <div className="mt-1.5">
                  <DataSourceBadge source={result.source} fetchedAt={result.fetchedAt} />
                </div>
              </Metric>
            </MetricStrip>
          </Card>

          {top.length > 1 && (
            <Card className="mb-4">
              <CardHeader title="Referring domains by target" description={`Top ${top.length} targets`} />
              <CardBody>
                <BarChart data={top.map((r) => ({ target: r.target.length > 34 ? `${r.target.slice(0, 32)}…` : r.target, rd: r.referringDomains ?? 0 }))} xKey="target" layout="bars" categoryWidth={190} valueLabels series={[{ key: "rd", label: "Referring domains" }]} height={Math.max(160, top.length * 28)} />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Comparison table" description="Click a column to sort. Export includes every metric." />
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(r) => r.target}
              defaultSort={{ key: "referringDomains", dir: "desc" }}
              pageSize={50}
              searchable
              searchPlaceholder="Filter targets"
              searchText={(r) => r.target}
              onRowsChange={onRowsChange}
              toolbar={
                <div className="flex flex-1 items-center">
                  <ExportButton onClick={exportCsv} className="ml-auto" />
                </div>
              }
            />
          </Card>
        </>
      )}
    </>
  );
}
