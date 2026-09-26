"use client";

import { FileUp, Plus, Sparkles } from "lucide-react";
import Papa from "papaparse";
import { useEffect, useMemo, useRef, useState } from "react";
import { compact } from "@/lib/format";
import type { KeywordEntry } from "@/lib/position-tracking/types";
import { cn } from "@/lib/utils";
import { KdBadge } from "@/components/seo/badges";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/input";

export type Suggestion = { keyword: string; position: number; volume: number; kd: number };

const norm = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const splitTags = (s: string) =>
  s
    .split(/[,;]/)
    .map((t) => t.trim().replace(/\s+/g, " "))
    .filter(Boolean);

/**
 * Parses the keyword box: one keyword per line, or comma-separated. Tags per keyword after a "|" or tab:
 * `running shoes | shoes, brand`. `globalTags` apply to every keyword.
 */
export function parseKeywords(text: string, globalTags: string, max: number) {
  const shared = splitTags(globalTags);
  const map = new Map<string, Set<string>>();
  let duplicates = 0;
  const errors: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [kwPart, tagPart] = line.includes("|") ? line.split("|", 2) : line.includes("\t") ? line.split("\t", 2) : [line, ""];
    const keywords = line.includes("|") || line.includes("\t") ? [kwPart] : kwPart.split(",");
    for (const k of keywords) {
      const keyword = norm(k);
      if (!keyword) continue;
      if (keyword.length > 255) {
        errors.push(`“${keyword.slice(0, 40)}…” is longer than 255 characters.`);
        continue;
      }
      if (/\b(site|inurl|intitle|allintitle|filetype):/.test(keyword)) {
        errors.push(`Search operators are not supported (“${keyword.slice(0, 40)}”).`);
        continue;
      }
      if (map.has(keyword)) duplicates++;
      const set = map.get(keyword) ?? new Set<string>();
      for (const t of [...splitTags(tagPart ?? ""), ...shared]) if (t.length <= 40) set.add(t);
      map.set(keyword, set);
    }
  }
  const entries: KeywordEntry[] = [...map.entries()].map(([keyword, tags]) => ({ keyword, tags: [...tags] }));
  if (entries.length > max) errors.push(`You can add ${max.toLocaleString()} more keyword${max === 1 ? "" : "s"} to this campaign; remove ${entries.length - max}.`);
  return { entries, duplicates, errors };
}

const NONE: string[] = [];
const NO_SUGGESTIONS: Suggestion[] = [];

export function KeywordInput({
  initial = "",
  suggestions = NO_SUGGESTIONS,
  existing = NONE,
  max,
  onChange,
  tagNames = NONE,
}: {
  initial?: string;
  suggestions?: Suggestion[];
  /** Keywords already tracked (skipped, shown as tracked in suggestions). */
  existing?: string[];
  max: number;
  onChange: (result: ReturnType<typeof parseKeywords>) => void;
  tagNames?: string[];
}) {
  const [text, setText] = useState(initial);
  const [tags, setTags] = useState("");
  const [csvNote, setCsvNote] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const tracked = useMemo(() => new Set(existing), [existing]);

  const parsed = useMemo(() => {
    const p = parseKeywords(text, tags, max + 0);
    const fresh = p.entries.filter((e) => !tracked.has(e.keyword));
    const skipped = p.entries.length - fresh.length;
    const errors = [...p.errors.filter((e) => !e.startsWith("You can add"))];
    if (fresh.length > max) errors.push(`You can add ${max.toLocaleString()} more keyword${max === 1 ? "" : "s"}; remove ${fresh.length - max}.`);
    return { entries: fresh, duplicates: p.duplicates + skipped, errors, skipped };
  }, [text, tags, max, tracked]);
  useEffect(() => onChange(parsed), [parsed, onChange]);

  const inBox = useMemo(() => new Set(parsed.entries.map((e) => e.keyword)), [parsed.entries]);
  const append = (lines: string[]) => setText((t) => [t.trim(), ...lines].filter(Boolean).join("\n"));

  const onCsv = (file: File) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (res) => {
        const rows = res.data.filter((r) => Array.isArray(r) && r.some((c) => String(c).trim()));
        if (!rows.length) return setCsvNote("The file is empty.");
        const header = rows[0].map((c) => String(c).trim().toLowerCase());
        const kIdx = header.findIndex((h) => ["keyword", "keywords", "query", "search term", "term"].includes(h));
        const tIdx = header.findIndex((h) => ["tag", "tags", "label", "labels", "group"].includes(h));
        const body = kIdx >= 0 ? rows.slice(1) : rows;
        const ki = kIdx >= 0 ? kIdx : 0;
        const ti = kIdx >= 0 ? tIdx : rows[0].length > 1 ? 1 : -1;
        const lines = body
          .map((r) => {
            const k = String(r[ki] ?? "").trim();
            const t = ti >= 0 ? String(r[ti] ?? "").trim() : "";
            return k ? (t ? `${k} | ${t}` : k) : "";
          })
          .filter(Boolean);
        append(lines);
        setCsvNote(`Imported ${lines.length.toLocaleString()} row${lines.length === 1 ? "" : "s"} from ${file.name}${ti >= 0 ? " (with tags)" : ""}.`);
      },
      error: () => setCsvNote("Could not read that file. Upload a .csv or .txt with one keyword per row."),
    });
  };

  const visible = suggestions.filter((s) => !filter || s.keyword.includes(filter.toLowerCase()));
  const addable = (s: Suggestion) => !inBox.has(s.keyword) && !tracked.has(s.keyword);

  return (
    <div className={cn("grid gap-4", suggestions.length > 0 && "lg:grid-cols-[1.15fr_1fr]")}>
      <div className="min-w-0 space-y-3">
        <Field
          label="Keywords"
          htmlFor="pt-keywords"
          hint={
            <>
              One per line or comma-separated. Add tags after a bar: <code className="rounded bg-surface-3 px-1">running shoes | shoes, brand</code>
            </>
          }
        >
          <Textarea id="pt-keywords" value={text} onChange={(e) => setText(e.target.value)} rows={9} placeholder={"best running shoes\nrunning shoes for women | shoes\ntrail running tips"} className="font-mono text-[12.5px]" />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => e.target.files?.[0] && onCsv(e.target.files[0])} />
          <Button type="button" size="sm" onClick={() => fileRef.current?.click()}>
            <FileUp className="h-3.5 w-3.5" /> Upload CSV
          </Button>
          {text && (
            <Button type="button" size="sm" variant="ghost" onClick={() => (setText(""), setCsvNote(null))}>
              Clear
            </Button>
          )}
          <span className="ml-auto text-[12.5px] text-text-2">
            <span className="font-semibold text-text">{parsed.entries.length.toLocaleString()}</span> keyword{parsed.entries.length === 1 ? "" : "s"}
            {parsed.duplicates > 0 && <span className="text-text-3"> · {parsed.duplicates} duplicate{parsed.duplicates === 1 ? "" : "s"}{parsed.skipped ? " or already tracked" : ""} skipped</span>}
          </span>
        </div>
        {csvNote && <p className="text-[12px] text-text-3">{csvNote}</p>}
        <Field label="Tags for these keywords (optional)" htmlFor="pt-tags" hint={tagNames.length ? `Existing tags: ${tagNames.slice(0, 8).join(", ")}${tagNames.length > 8 ? "…" : ""}` : "Comma-separated, e.g. brand, blog"}>
          <Input id="pt-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. brand, product pages" list="pt-tag-names" />
          {tagNames.length > 0 && (
            <datalist id="pt-tag-names">
              {tagNames.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          )}
        </Field>
        {parsed.errors.map((e) => (
          <p key={e} className="text-[12px] text-critical-ink">
            {e}
          </p>
        ))}
      </div>
      {suggestions.length > 0 && (
        <div className="flex min-w-0 flex-col rounded-lg border border-border">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <Sparkles className="h-3.5 w-3.5 text-brand" />
            <span className="text-[13px] font-semibold">Suggestions</span>
            <span className="text-[11.5px] text-text-3">keywords your domain ranks for</span>
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" className="ml-auto h-7 w-32 text-[12px]" aria-label="Filter suggestions" />
          </div>
          <div className="scroll-thin max-h-72 overflow-y-auto">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-surface-2 text-left text-[11.5px] text-text-3">
                <tr>
                  <th className="w-8 px-3 py-1.5" />
                  <th className="py-1.5 font-medium">Keyword</th>
                  <th className="px-2 py-1.5 text-right font-medium">Pos.</th>
                  <th className="px-2 py-1.5 text-right font-medium">Volume</th>
                  <th className="px-3 py-1.5 text-right font-medium">KD</th>
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, 150).map((s) => {
                  const can = addable(s);
                  return (
                    <tr key={s.keyword} className={cn("border-t border-border", !can && "opacity-50")}>
                      <td className="px-3 py-1.5">
                        <Checkbox
                          aria-label={`Select ${s.keyword}`}
                          disabled={!can}
                          checked={!can || picked.has(s.keyword)}
                          onChange={() =>
                            setPicked((p) => {
                              const n = new Set(p);
                              if (n.has(s.keyword)) n.delete(s.keyword);
                              else n.add(s.keyword);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td className="max-w-0 truncate py-1.5" title={s.keyword}>
                        {s.keyword}
                        {tracked.has(s.keyword) && <span className="ml-1 text-[11px] text-text-3">(tracked)</span>}
                      </td>
                      <td className="tabular px-2 py-1.5 text-right">{s.position}</td>
                      <td className="tabular px-2 py-1.5 text-right">{compact(s.volume)}</td>
                      <td className="px-3 py-1.5 text-right">
                        <KdBadge kd={s.kd} />
                      </td>
                    </tr>
                  );
                })}
                {!visible.length && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-text-3">
                      No suggestions match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-border px-3 py-2">
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={!picked.size}
              onClick={() => {
                append([...picked].filter((k) => !inBox.has(k)));
                setPicked(new Set());
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add selected{picked.size ? ` (${picked.size})` : ""}
            </Button>
            <Button type="button" size="sm" onClick={() => append(suggestions.filter(addable).slice(0, 25).map((s) => s.keyword))}>
              Add top 25
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => append(suggestions.filter(addable).slice(0, 100).map((s) => s.keyword))}>
              Add top 100
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
