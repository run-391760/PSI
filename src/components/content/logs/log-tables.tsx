"use client";

import { useMemo, useState } from "react";
import type { LogSummary } from "@/lib/content/logs/parser";
import { dateTimeLabel, timeAgo } from "@/lib/format";
import { StatusBadge, frequency } from "./status";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";

type PageRow = LogSummary["pages"][number];
type ErrorRow = LogSummary["errors"][number];

const TYPE_LABELS: Record<string, string> = { page: "Pages", js: "JavaScript", css: "CSS", image: "Images", font: "Fonts", json: "JSON / API", xml: "XML", txt: "Text", pdf: "PDF", media: "Media", other: "Other" };

function PathCell({ path }: { path: string }) {
  return (
    <span className="block max-w-[420px] min-w-[200px] truncate font-mono text-[12.5px] text-text" title={path}>
      {path}
    </span>
  );
}

export function CrawledPagesTable({ rows, days, names, fileName }: { rows: PageRow[]; days: number; names: Record<string, string>; fileName: string }) {
  const [scope, setScope] = useState<"all" | "google" | "bing" | "ai">("all");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("page");
  const types = useMemo(() => [...new Set(rows.map((r) => r.type))], [rows]);
  const filtered = useMemo(
    () =>
      rows
        .filter((r) => (type === "all" ? true : r.type === type))
        .filter((r) => (scope === "all" ? true : r[scope] > 0))
        .filter((r) => (status === "all" ? true : status === "2xx" ? r.s2 > 0 : status === "3xx" ? r.s3 > 0 : status === "4xx" ? r.s4 > 0 : r.s5 > 0)),
    [rows, type, scope, status],
  );
  const hits = (r: PageRow) => (scope === "all" ? r.hits : r[scope]);
  const columns: Column<PageRow>[] = [
    { key: "path", header: "URL", render: (r) => <PathCell path={r.path} /> },
    { key: "hits", header: scope === "all" ? "Bot hits" : "Hits", align: "right", sortValue: hits, render: (r) => hits(r).toLocaleString("en-US") },
    { key: "google", header: "Google", align: "right", render: (r) => (r.google ? r.google.toLocaleString("en-US") : <span className="text-text-3">–</span>) },
    { key: "bing", header: "Bing", align: "right", render: (r) => (r.bing ? r.bing.toLocaleString("en-US") : <span className="text-text-3">–</span>) },
    { key: "ai", header: "AI bots", align: "right", render: (r) => (r.ai ? r.ai.toLocaleString("en-US") : <span className="text-text-3">–</span>) },
    { key: "topBot", header: "Top bot", render: (r) => <span className="whitespace-nowrap text-text-2">{names[r.topBot] ?? r.topBot}</span>, csv: (r) => names[r.topBot] ?? r.topBot },
    { key: "last", header: "Last crawl", render: (r) => <span className="whitespace-nowrap text-text-2" title={dateTimeLabel(r.last)}>{timeAgo(r.last)}</span>, csv: (r) => r.last },
    { key: "lastStatus", header: "Last status", align: "center", render: (r) => <StatusBadge code={r.lastStatus} /> },
    { key: "freq", header: "Crawl frequency", align: "right", sortValue: (r) => hits(r) / Math.max(1, days), render: (r) => <span className="whitespace-nowrap">{frequency(hits(r), days)}</span>, csv: (r) => frequency(hits(r), days) },
    { key: "days", header: "Days crawled", align: "right", info: "Distinct days with at least one bot hit.", render: (r) => `${r.days} / ${days}` },
  ];
  return (
    <DataTable
      rows={filtered}
      columns={columns}
      rowKey={(r) => r.path}
      defaultSort={{ key: "hits", dir: "desc" }}
      searchable
      searchPlaceholder="Filter URLs"
      searchText={(r) => r.path}
      exportName={`${fileName}-crawled-pages`}
      toolbar={
        <>
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: "all", label: "All bots" },
              { value: "google", label: "Google" },
              { value: "bing", label: "Bing" },
              { value: "ai", label: "AI" },
            ]}
          />
          <Select value={type} onChange={(e) => setType(e.target.value)} className="h-8 w-auto text-[12.5px]" aria-label="File type">
            <option value="all">All file types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-auto text-[12.5px]" aria-label="Status">
            <option value="all">Any status</option>
            <option value="2xx">Had 2xx</option>
            <option value="3xx">Had 3xx</option>
            <option value="4xx">Had 4xx</option>
            <option value="5xx">Had 5xx</option>
          </Select>
        </>
      }
      emptyText="No crawled URLs match the filters."
    />
  );
}

export function ErrorsTable({ rows, names, fileName }: { rows: ErrorRow[]; names: Record<string, string>; fileName: string }) {
  const [cls, setCls] = useState<"all" | "4xx" | "5xx">("all");
  const filtered = rows.filter((r) => (cls === "all" ? true : cls === "4xx" ? r.status < 500 : r.status >= 500));
  const columns: Column<ErrorRow>[] = [
    { key: "path", header: "URL", render: (r) => <PathCell path={r.path} /> },
    { key: "status", header: "Status", align: "center", render: (r) => <StatusBadge code={r.status} /> },
    { key: "hits", header: "Error hits", align: "right", render: (r) => r.hits.toLocaleString("en-US") },
    { key: "bots", header: "Bots", sortable: false, render: (r) => <span className="text-text-2">{r.bots.map((b) => names[b] ?? b).join(", ")}</span>, csv: (r) => r.bots.map((b) => names[b] ?? b).join("; ") },
    { key: "last", header: "Last seen", render: (r) => <span className="whitespace-nowrap text-text-2" title={dateTimeLabel(r.last)}>{timeAgo(r.last)}</span>, csv: (r) => r.last },
  ];
  return (
    <DataTable
      rows={filtered}
      columns={columns}
      rowKey={(r) => r.path}
      defaultSort={{ key: "hits", dir: "desc" }}
      searchable
      searchPlaceholder="Filter URLs"
      searchText={(r) => r.path}
      exportName={`${fileName}-bot-errors`}
      pageSize={10}
      toolbar={
        <Segmented
          value={cls}
          onChange={setCls}
          options={[
            { value: "all", label: "All errors" },
            { value: "4xx", label: "4xx" },
            { value: "5xx", label: "5xx" },
          ]}
        />
      }
      emptyText="Bots received no error responses."
    />
  );
}
