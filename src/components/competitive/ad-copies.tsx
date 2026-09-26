"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Segmented } from "@/components/ui/tabs";
import { compact, monthLabel } from "@/lib/format";
import type { AdCopy } from "@/lib/competitive/advertising-research";
import { cn } from "@/lib/utils";
import { CsvButton } from "./csv-button";
import { SearchBox } from "./filters";

/** Ad copies found for a domain: SERP-style ad cards with keyword counts, search and sorting. */
export function AdCopies({ copies, db, domain }: { copies: AdCopy[]; db: string; domain: string }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"keywords" | "traffic">("keywords");
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return copies
      .filter((c) => !needle || `${c.title} ${c.description} ${c.keywords.join(" ")}`.toLowerCase().includes(needle))
      .sort((a, b) => (sort === "keywords" ? b.keywords.length - a.keywords.length : b.traffic - a.traffic));
  }, [copies, q, sort]);
  const csv: (string | number | null)[][] = [["Title", "Description", "URL", "Keywords", "Traffic", "First seen", "Last seen", "Keyword list"], ...list.map((c) => [c.title, c.description, c.url, c.keywords.length, c.traffic, c.firstSeen, c.lastSeen, c.keywords.join(", ")])];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        <SearchBox value={q} onChange={setQ} placeholder="Search ad text or keyword" className="w-64" />
        <Segmented
          options={[
            { value: "keywords", label: "Most keywords" },
            { value: "traffic", label: "Most traffic" },
          ]}
          value={sort}
          onChange={setSort}
        />
        <span className="text-[12.5px] text-text-3">{list.length.toLocaleString()} ads</span>
        <CsvButton className="ml-auto" filename={`${domain}-ad-copies-${db}`} rows={csv} />
      </div>
      {list.length === 0 ? (
        <p className="border-t border-border py-10 text-center text-[13px] text-text-3">No ads match your search.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 border-t border-border p-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((c) => {
            const expanded = open === c.id;
            return (
              <article key={c.id} className="flex min-w-0 flex-col rounded-lg border border-border bg-surface p-3.5">
                <div className="truncate text-[11.5px] text-text-3">
                  <span className="mr-1.5 font-semibold text-text">Sponsored</span>
                  {c.displayUrl}
                </div>
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 line-clamp-2 text-[15px] leading-snug text-link hover:underline">
                  {c.title}
                </a>
                <p className="mt-1 line-clamp-3 text-[12.5px] text-text-2">{c.description}</p>
                <div className="mt-auto pt-3">
                  <div className="flex items-center justify-between gap-2 border-t border-border pt-2.5 text-[12px]">
                    <button type="button" onClick={() => setOpen(expanded ? null : c.id)} className="inline-flex items-center gap-1 font-medium text-link hover:underline">
                      {c.keywords.length} keyword{c.keywords.length === 1 ? "" : "s"}
                      {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                    <span className="text-text-3">
                      {compact(c.traffic)} visits · since {monthLabel(c.firstSeen)}
                    </span>
                  </div>
                  <ul className={cn("mt-2 flex flex-wrap gap-1", !expanded && "max-h-[46px] overflow-hidden")}>
                    {(expanded ? c.keywords : c.keywords.slice(0, 4)).map((k) => (
                      <li key={k}>
                        <Link href={`/keyword-overview?q=${encodeURIComponent(k)}&db=${db}`} className="inline-flex h-5 items-center rounded bg-surface-3 px-1.5 text-[11.5px] text-text-2 hover:text-text">
                          {k}
                        </Link>
                      </li>
                    ))}
                    {!expanded && c.keywords.length > 4 && <li className="inline-flex h-5 items-center px-1 text-[11.5px] text-text-3">+{c.keywords.length - 4}</li>}
                  </ul>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
