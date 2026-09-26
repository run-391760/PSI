"use client";

import { Globe, KeyRound, Link2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState, useTransition } from "react";
import { classifyQuery, DATABASES, tryRootDomain } from "@/lib/domain";
import { Button } from "@/components/ui/button";

const EXAMPLES = [
  { label: "nike.com", value: "nike.com" },
  { label: "running shoes", value: "running shoes" },
  { label: "coursera.org", value: "coursera.org" },
  { label: "crm software", value: "crm software" },
];

/** Resolve free text to the tool that should open: Domain Overview (domain/URL) or Keyword Overview. */
function target(value: string, db: string) {
  const v = value.trim();
  if (!v) return null;
  const c = classifyQuery(v);
  if (c.kind === "domain" || c.kind === "url") {
    const domain = tryRootDomain(c.value);
    if (domain) return { tool: "Domain Overview", subject: domain, kind: c.kind, href: `/domain-overview?q=${encodeURIComponent(domain)}&db=${db}` };
  }
  return { tool: "Keyword Overview", subject: c.value, kind: "keyword" as const, href: `/keyword-overview?q=${encodeURIComponent(c.value)}&db=${db}` };
}

/** Home hero search: one box for a domain, URL or keyword plus the regional database. */
export function HeroSearch({ defaultDb = "US" }: { defaultDb?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [db, setDb] = useState(defaultDb);
  const [pending, start] = useTransition();
  const t = useMemo(() => target(q, db), [q, db]);

  const go = (value: string) => {
    const dest = target(value, db);
    if (dest) start(() => router.push(dest.href));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    go(q);
  };
  const Icon = t?.kind === "keyword" ? KeyRound : t?.kind === "url" ? Link2 : Globe;

  return (
    <div>
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4.5 w-4.5 -translate-y-1/2 text-text-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Enter a domain, URL or keyword"
            aria-label="Domain, URL or keyword"
            className="h-11 w-full rounded-lg border border-border-strong bg-surface pr-3 pl-10 text-[14.5px] text-text placeholder:text-text-3 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none"
          />
        </div>
        <select
          value={db}
          onChange={(e) => setDb(e.target.value)}
          aria-label="Regional database"
          className="h-11 rounded-lg border border-border-strong bg-surface px-3 text-[13.5px] text-text focus:border-brand focus:outline-none sm:w-48"
        >
          {DATABASES.map((d) => (
            <option key={d.code} value={d.code}>
              {d.flag} {d.name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="primary" size="lg" loading={pending} className="h-11 px-6" disabled={!q.trim()}>
          Search
        </Button>
      </form>
      <div className="mt-2.5 flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-text-3">
        {t ? (
          <span className="inline-flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5" /> Opens <span className="font-medium text-text-2">{t.tool}</span> for <span className="max-w-[260px] truncate font-medium text-text-2">{t.subject}</span>
          </span>
        ) : (
          <>
            <span>Try:</span>
            {EXAMPLES.map((e) => (
              <button key={e.value} type="button" onClick={() => (setQ(e.value), go(e.value))} className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-text-2 hover:border-border-strong hover:text-text">
                {e.label}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
