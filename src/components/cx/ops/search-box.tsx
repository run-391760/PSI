"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applySuggestion, searchSuggestions } from "@/lib/cx/inbox/model";
import { cn } from "@/lib/utils";

/** Quick-search input with the inbox's field:value autocomplete (Tab to complete). */
export function QuickSearchBox({ brand, initial, only, fields }: { brand: string; initial: string; only: string; fields: { key: string; label: string; options: string[] }[] }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [focus, setFocus] = useState(false);
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const extra = useMemo(() => fields, [fields]);
  const sugg = focus ? searchSuggestions(q, extra) : [];
  const pick = (insert: string) => { setQ(applySuggestion(q, insert)); setIdx(0); ref.current?.focus(); };
  return (
    <form className="flex max-w-3xl gap-2" onSubmit={(e) => { e.preventDefault(); setFocus(false); router.push(`/cx/search?brand=${brand}&q=${encodeURIComponent(q.trim())}${only ? `&in=${only}` : ""}`); }}>
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-text-3" />
        <Input
          ref={ref} value={q} autoFocus={!initial} onChange={(e) => { setQ(e.target.value); setIdx(0); }} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
          onKeyDown={(e) => {
            if (!sugg.length) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => (i + 1) % sugg.length); }
            if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => (i - 1 + sugg.length) % sugg.length); }
            if (e.key === "Tab") { e.preventDefault(); pick(sugg[idx].insert); }
          }}
          placeholder="Search tickets, messages, contacts, mentions, tasks…" className="h-10 pl-9 text-[14px]" aria-label="Quick search" autoComplete="off"
          role="combobox" aria-expanded={sugg.length > 0} aria-controls="qs-sugg"
        />
        {sugg.length > 0 && (
          <ul id="qs-sugg" role="listbox" className="absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-card">
            {sugg.map((s, i) => (
              <li key={s.insert} role="option" aria-selected={i === idx}>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(s.insert); }} className={cn("flex w-full items-center justify-between gap-3 rounded px-2 py-1 text-left text-[12.5px]", i === idx ? "bg-surface-3" : "hover:bg-surface-3")}>
                  <code className="text-text">{s.label}</code><span className="truncate text-text-3">{s.hint}</span>
                </button>
              </li>
            ))}
            <li className="px-2 pt-1 text-[11px] text-text-3">Tab to complete · Enter to search · prefix “-” to exclude</li>
          </ul>
        )}
      </div>
      <Button type="submit" variant="primary" className="h-10">Search</Button>
    </form>
  );
}
