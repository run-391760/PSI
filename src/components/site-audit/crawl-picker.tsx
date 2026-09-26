"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/input";

type Opt = { id: string; label: string };

/** Switch which crawl the report shows (?crawl=); the newest finished crawl is the default. */
export function CrawlPicker({ options, current, latestId }: { options: Opt[]; current: string; latestId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  if (options.length < 2) return null;
  return (
    <Select
      aria-label="Crawl"
      value={current}
      onChange={(e) => {
        const p = new URLSearchParams(search.toString());
        if (e.target.value === latestId) p.delete("crawl");
        else p.set("crawl", e.target.value);
        p.delete("page");
        router.push(`${pathname}?${p.toString()}`);
      }}
      className="h-8 w-auto max-w-[240px] text-[12.5px]"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

/** Pick the two crawls to compare (?a= older, ?b= newer). */
export function ComparePicker({ options, a, b }: { options: Opt[]; a: string; b: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const go = (key: "a" | "b", v: string) => {
    const p = new URLSearchParams(search.toString());
    p.set("tab", "compare");
    p.set(key, v);
    router.push(`${pathname}?${p.toString()}`, { scroll: false });
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-text-2">
      <span>Compare</span>
      <Select aria-label="Older crawl" value={a} onChange={(e) => go("a", e.target.value)} className="h-8 w-auto max-w-[220px] text-[12.5px]">
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
      <span>with</span>
      <Select aria-label="Newer crawl" value={b} onChange={(e) => go("b", e.target.value)} className="h-8 w-auto max-w-[220px] text-[12.5px]">
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
