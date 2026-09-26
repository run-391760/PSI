"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { DATABASES } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Tool search bar: text input + regional database select. Submitting navigates to the current page
 * with ?q=<value>&db=<code> (other params reset unless listed in `keep`).
 */
export function ToolSearch({
  placeholder = "Enter domain, subdomain or URL",
  buttonLabel = "Search",
  showDb = true,
  param = "q",
  keep = [],
  action,
  className,
  defaultValue,
  multi,
}: {
  placeholder?: string;
  buttonLabel?: string;
  showDb?: boolean;
  param?: string;
  keep?: string[];
  /** Target path; defaults to the current page. */
  action?: string;
  className?: string;
  defaultValue?: string;
  /** Render a textarea for multi-line input (one entry per line). */
  multi?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [value, setValue] = useState(defaultValue ?? search.get(param) ?? "");
  const [db, setDb] = useState(search.get("db") ?? "US");
  const [pending, start] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    const params = new URLSearchParams();
    for (const k of keep) {
      const v = search.get(k);
      if (v) params.set(k, v);
    }
    params.set(param, value.trim());
    if (showDb) params.set("db", db);
    start(() => router.push(`${action ?? pathname}?${params.toString()}`));
  };

  return (
    <form onSubmit={submit} className={cn("flex w-full flex-col gap-2 sm:flex-row", className)}>
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-text-3" />
        {multi ? (
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            rows={3}
            className="w-full rounded-md border border-border-strong bg-surface py-2 pr-3 pl-9 text-[13.5px] placeholder:text-text-3 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
          />
        ) : (
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="h-9.5 w-full rounded-md border border-border-strong bg-surface pr-3 pl-9 text-[13.5px] placeholder:text-text-3 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
            aria-label={placeholder}
          />
        )}
      </div>
      {showDb && (
        <select
          value={db}
          onChange={(e) => setDb(e.target.value)}
          className="h-9.5 rounded-md border border-border-strong bg-surface px-2.5 text-[13px] focus:border-brand focus:outline-none sm:w-44"
          aria-label="Regional database"
        >
          {DATABASES.map((d) => (
            <option key={d.code} value={d.code}>
              {d.flag} {d.name}
            </option>
          ))}
        </select>
      )}
      <Button type="submit" variant="primary" size="lg" loading={pending} className="h-9.5">
        {buttonLabel}
      </Button>
    </form>
  );
}

/** Compact regional-database switcher that rewrites ?db= on the current URL. */
export function DbSwitcher({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const db = search.get("db") ?? "US";
  return (
    <select
      value={db}
      onChange={(e) => {
        const params = new URLSearchParams(search.toString());
        params.set("db", e.target.value);
        router.push(`${pathname}?${params.toString()}`);
      }}
      className={cn("h-7 rounded-md border border-border-strong bg-surface px-2 text-[12.5px] focus:outline-none", className)}
      aria-label="Regional database"
    >
      {DATABASES.map((d) => (
        <option key={d.code} value={d.code}>
          {d.flag} {d.code}
        </option>
      ))}
    </select>
  );
}
