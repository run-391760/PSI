"use client";

import { Check, Copy, ListPlus, Swords } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { AsBadge, DomainAvatar, DomainLink, IntentBadges, KdBadge, KeywordLink, PositionChange, SerpFeatureIcons, TrendBars } from "@/components/seo/badges";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Bar } from "@/components/ui/progress";
import { compact, displayUrl, duration, money, num, pct } from "@/lib/format";
import { compareHref, keywordListHref } from "@/lib/competitive/links";
import type { Intent, SerpFeature } from "@/lib/seo/types";
import { cn } from "@/lib/utils";

export type AutoColumnType =
  | "text"
  | "keyword"
  | "domain"
  | "url"
  | "link"
  | "compact"
  | "number"
  | "decimal"
  | "percent"
  | "money"
  | "duration"
  | "share"
  | "level"
  | "as"
  | "kd"
  | "intents"
  | "trend"
  | "delta"
  | "position"
  | "features";

/** Serializable column spec, so server pages can describe a table without passing functions. */
export type AutoColumn = {
  key: string;
  header: string;
  type?: AutoColumnType;
  align?: "left" | "right" | "center";
  info?: string;
  width?: string;
  sortable?: boolean;
  /** `link`/`domain`: href template, `{field}` is replaced by the URL-encoded row value. */
  href?: string;
  /** `position`: key of the previous position (renders the change next to it). */
  prevKey?: string;
  /** `features`: key of the owned features. */
  ownedKey?: string;
  /** `share`: key of a max value, or a fixed max (defaults to 100). */
  max?: number;
  /** `delta`: whether up is good (default true). */
  upIsGood?: boolean;
  /** Extra cell class. */
  className?: string;
};

export type SelectionAction =
  | { type: "keyword-list"; key: string; db: string }
  | { type: "keyword-gap"; key: string; base: string; db: string; gapType?: "organic" | "paid" }
  | { type: "copy"; key: string; label?: string };

type Row = Record<string, unknown>;

const fill = (tpl: string, row: Row) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(String(row[k] ?? "")));

function cellFor(c: AutoColumn, row: Row, db: string | undefined, highlightKey?: string): ReactNode {
  const v = row[c.key];
  const n = typeof v === "number" ? v : null;
  switch (c.type ?? "text") {
    case "keyword":
      return <KeywordLink keyword={String(v)} db={db} className="whitespace-nowrap" />;
    case "domain": {
      const you = highlightKey && row[highlightKey] ? (
        <Badge tone="brand" className="ml-1.5">
          You
        </Badge>
      ) : null;
      if (c.href)
        return (
          <span className="inline-flex min-w-0 items-center">
            <Link href={fill(c.href, row)} className="inline-flex min-w-0 items-center gap-1.5 text-link hover:underline">
              <DomainAvatar domain={String(v)} />
              <span className="truncate">{String(v)}</span>
            </Link>
            {you}
          </span>
        );
      return (
        <span className="inline-flex min-w-0 items-center">
          <DomainLink domain={String(v)} db={db} />
          {you}
        </span>
      );
    }
    case "url":
      return v ? (
        <a href={String(v)} target="_blank" rel="noopener noreferrer" className="block max-w-[280px] truncate text-link hover:underline" title={String(v)}>
          {displayUrl(String(v).split("?")[0])}
        </a>
      ) : (
        <span className="text-text-3">n/a</span>
      );
    case "link":
      return (
        <Link href={fill(c.href ?? "#", row)} className="text-link hover:underline">
          {typeof v === "number" ? compact(v) : String(v ?? "")}
        </Link>
      );
    case "compact":
      return compact(n);
    case "number":
      return num(n);
    case "decimal":
      return num(n, 2);
    case "percent":
      return pct(n, n != null && Math.abs(n) < 1 && n !== 0 ? 2 : 1);
    case "money":
      return money(n);
    case "duration":
      return n == null ? "n/a" : duration(n);
    case "share":
      return (
        <span className="inline-flex items-center justify-end gap-2">
          <Bar value={n ?? 0} max={c.max ?? 100} className="w-16" />
          <span className="tabular w-12 text-right text-text-2">{pct(n, n != null && n < 1 ? 2 : 1)}</span>
        </span>
      );
    case "level":
      return <Bar value={(n ?? 0) * 100} className="w-24" />;
    case "as":
      return n == null ? <span className="text-text-3">n/a</span> : <AsBadge score={n} />;
    case "kd":
      return <KdBadge kd={n} />;
    case "intents":
      return <IntentBadges intents={(v as Intent[]) ?? []} />;
    case "trend":
      return Array.isArray(v) && v.length ? <TrendBars values={v as number[]} /> : <span className="text-text-3">n/a</span>;
    case "delta": {
      if (n == null) return <span className="text-text-3">n/a</span>;
      const good = n === 0 ? null : n > 0 === (c.upIsGood ?? true);
      return <span className={cn("tabular font-medium", good === null ? "text-text-3" : good ? "text-good-ink" : "text-critical-ink")}>{pct(n, 1, true)}</span>;
    }
    case "position": {
      const prev = c.prevKey ? (row[c.prevKey] as number | null | undefined) : undefined;
      return (
        <span className="inline-flex items-center justify-end gap-2">
          <span className="tabular">{n ?? "–"}</span>
          {c.prevKey && (
            <span className="inline-flex w-9 justify-start">
              <PositionChange previous={prev} current={n} compact />
            </span>
          )}
        </span>
      );
    }
    case "features":
      return <SerpFeatureIcons features={(v as SerpFeature[]) ?? []} owned={c.ownedKey ? ((row[c.ownedKey] as SerpFeature[]) ?? []) : []} max={4} />;
    default:
      return v == null || v === "" ? <span className="text-text-3">n/a</span> : String(v);
  }
}

function csvFor(c: AutoColumn, row: Row): string | number | null | undefined {
  const v = row[c.key];
  if (Array.isArray(v)) return v.join(c.type === "trend" ? "|" : ", ");
  if (v == null) return "";
  return v as string | number;
}

function sortFor(c: AutoColumn, row: Row): number | string | null | undefined {
  const v = row[c.key];
  if (Array.isArray(v)) return c.type === "intents" ? String(v[0] ?? "") : v.length;
  if (v == null) return null;
  return v as number | string;
}

const RIGHT: AutoColumnType[] = ["compact", "number", "decimal", "percent", "money", "duration", "share", "as", "kd", "delta", "position"];

/**
 * Generic report table (sorting, paging, quick filter, CSV export, selection actions) driven by
 * serializable column specs. Rows are plain objects from the server.
 */
export function AutoTable({
  rows,
  columns,
  rowKey,
  db,
  defaultSort,
  exportName,
  searchable,
  searchKeys,
  searchPlaceholder,
  highlightKey,
  pageSize = 25,
  selection,
  dense,
  emptyText,
  title,
  className,
}: {
  rows: Row[];
  columns: AutoColumn[];
  rowKey: string;
  db?: string;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  exportName?: string;
  searchable?: boolean;
  searchKeys?: string[];
  searchPlaceholder?: string;
  /** Boolean row field that marks the analyzed domain (row is highlighted). */
  highlightKey?: string;
  pageSize?: number;
  selection?: SelectionAction;
  dense?: boolean;
  emptyText?: ReactNode;
  title?: ReactNode;
  className?: string;
}) {
  const cols: Column<Row>[] = columns.map((c) => ({
    key: c.key,
    header: c.header,
    csvHeader: c.header,
    align: c.align ?? (RIGHT.includes(c.type ?? "text") ? "right" : "left"),
    info: c.info,
    width: c.width,
    sortable: c.sortable,
    className: c.className,
    sortValue: (r) => sortFor(c, r),
    csv: (r) => csvFor(c, r),
    render: (r) => cellFor(c, r, db, highlightKey),
  }));
  return (
    <DataTable<Row>
      rows={rows}
      columns={cols}
      rowKey={(r) => String(r[rowKey])}
      defaultSort={defaultSort}
      exportName={exportName}
      searchable={searchable}
      searchPlaceholder={searchPlaceholder}
      searchText={searchKeys ? (r) => searchKeys.map((k) => String(r[k] ?? "")).join(" ") : undefined}
      pageSize={pageSize}
      selectable={Boolean(selection)}
      selectionActions={selection ? (selected, clear) => <SelectionButton action={selection} rows={selected} clear={clear} /> : undefined}
      rowClassName={highlightKey ? (r) => (r[highlightKey] ? "bg-brand-soft/40" : undefined) : undefined}
      dense={dense}
      emptyText={emptyText}
      title={title}
      className={className}
    />
  );
}

export function SelectionButton({ action, rows, clear }: { action: SelectionAction; rows: Row[]; clear?: () => void }) {
  const [copied, setCopied] = useState(false);
  const values = rows.map((r) => String(r[action.key]));
  if (action.type === "keyword-list")
    return (
      <ButtonLink href={keywordListHref(values, action.db)} size="sm" variant="primary" title={values.length > 300 ? "The first 300 keywords are added" : undefined}>
        <ListPlus className="h-3.5 w-3.5" /> Add to keyword list
      </ButtonLink>
    );
  if (action.type === "keyword-gap")
    return (
      <ButtonLink href={compareHref("/keyword-gap", [action.base, ...values.slice(0, 4)], { db: action.db, type: action.gapType })} size="sm" variant="primary" title="Compares the first 4 selected domains">
        <Swords className="h-3.5 w-3.5" /> Compare in Keyword Gap
      </ButtonLink>
    );
  return (
    <Button
      size="sm"
      variant="primary"
      onClick={async () => {
        await navigator.clipboard?.writeText(values.join("\n")).catch(() => undefined);
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
          clear?.();
        }, 1200);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : (action.label ?? "Copy")}
    </Button>
  );
}
