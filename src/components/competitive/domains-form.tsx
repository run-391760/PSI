"use client";

import { Plus, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { series } from "@/components/charts/theme";
import { Button } from "@/components/ui/button";
import { DATABASES } from "@/lib/domain";
import { cn } from "@/lib/utils";

const DOMAIN_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i;

/**
 * Multi-domain comparison form (Keyword Gap, Backlink Gap). Submits ?d=you&d=c1…&db=&type=.
 * The first domain is "You"; colors follow the fixed series order used by the report charts.
 */
export function DomainsForm({
  initial,
  max = 5,
  min = 2,
  db,
  showDb = true,
  typeOptions,
  type,
  submitLabel = "Compare",
  className,
}: {
  initial: string[];
  max?: number;
  min?: number;
  db?: string;
  showDb?: boolean;
  typeOptions?: { value: string; label: string }[];
  type?: string;
  submitLabel?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [values, setValues] = useState<string[]>(() => {
    const base = initial.slice(0, max);
    const target = Math.min(max, Math.max(min + 1, base.length));
    while (base.length < target) base.push("");
    return base;
  });
  const [dbValue, setDb] = useState(db ?? "US");
  const [typeValue, setType] = useState(type ?? typeOptions?.[0]?.value ?? "");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const set = (i: number, v: string) => setValues((arr) => arr.map((x, j) => (j === i ? v : x)));
  const remove = (i: number) => setValues((arr) => arr.filter((_, j) => j !== i));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const list = values.map((v) => v.trim()).filter(Boolean);
    const bad = list.find((v) => !DOMAIN_RE.test(v));
    if (bad) return setError(`“${bad}” is not a valid domain.`);
    if (!values[0]?.trim()) return setError("Enter your domain in the first field.");
    if (list.length < min) return setError(`Enter at least ${min} domains to compare.`);
    setError("");
    const params = new URLSearchParams();
    for (const d of list) params.append("d", d);
    if (showDb) params.set("db", dbValue);
    if (typeOptions) params.set("type", typeValue);
    start(() => router.push(`${pathname}?${params.toString()}`));
  };

  return (
    <form onSubmit={submit} className={cn("rounded-lg border border-border bg-surface p-3 shadow-card", className)}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {values.map((v, i) => (
          <div key={i} className="relative">
            <span className="pointer-events-none absolute top-1/2 left-2.5 flex -translate-y-1/2 items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: series(i) }} aria-hidden />
              <span className="text-[11.5px] font-medium text-text-3">{i === 0 ? "You" : `C${i}`}</span>
            </span>
            <input
              value={v}
              onChange={(e) => set(i, e.target.value)}
              placeholder={i === 0 ? "your-domain.com" : "competitor.com"}
              aria-label={i === 0 ? "Your domain" : `Competitor ${i}`}
              className="h-9 w-full rounded-md border border-border-strong bg-surface pr-7 pl-[3.2rem] text-[13px] placeholder:text-text-3 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
            />
            {i >= min && (
              <button type="button" onClick={() => remove(i)} className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-text-3 hover:bg-surface-3 hover:text-text" aria-label="Remove domain">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {values.length < max && (
          <button type="button" onClick={() => setValues((arr) => [...arr, ""])} className="flex h-9 items-center justify-center gap-1 rounded-md border border-dashed border-border-strong text-[12.5px] text-text-2 hover:bg-surface-2 hover:text-text">
            <Plus className="h-3.5 w-3.5" /> Add competitor
          </button>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {typeOptions && (
          <select value={typeValue} onChange={(e) => setType(e.target.value)} className="h-8 rounded-md border border-border-strong bg-surface px-2 text-[12.5px] focus:border-brand focus:outline-none" aria-label="Keyword type">
            {typeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {showDb && (
          <select value={dbValue} onChange={(e) => setDb(e.target.value)} className="h-8 rounded-md border border-border-strong bg-surface px-2 text-[12.5px] focus:border-brand focus:outline-none" aria-label="Regional database">
            {DATABASES.map((d) => (
              <option key={d.code} value={d.code}>
                {d.flag} {d.name}
              </option>
            ))}
          </select>
        )}
        {error && <span className="text-[12.5px] text-critical-ink">{error}</span>}
        <Button type="submit" variant="primary" loading={pending} className="ml-auto">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
