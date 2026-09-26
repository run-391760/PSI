"use client";

import { Monitor, Smartphone } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { DATABASES } from "@/lib/domain";
import { Spinner } from "@/components/ui/feedback";
import { Segmented } from "@/components/ui/tabs";

/** Regional database × device × category selectors for the SERP Sensor (URL-driven). */
export function SensorFilters({ categories, db, device, category }: { categories: { id: string; name: string }[]; db: string; device: "desktop" | "mobile"; category: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, start] = useTransition();
  const set = (key: string, value: string) => {
    const params = new URLSearchParams(search.toString());
    params.set(key, value);
    start(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
  };
  const select = "h-8.5 rounded-md border border-border-strong bg-surface px-2.5 text-[13px] text-text focus:border-brand focus:outline-none";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={db} onChange={(e) => set("db", e.target.value)} className={`${select} w-full sm:w-52`} aria-label="Regional database">
        {DATABASES.map((d) => (
          <option key={d.code} value={d.code}>
            {d.flag} {d.name}
          </option>
        ))}
      </select>
      <select value={category} onChange={(e) => set("category", e.target.value)} className={`${select} w-full sm:w-60`} aria-label="Category">
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <Segmented
        size="md"
        value={device}
        onChange={(v) => set("device", v)}
        options={[
          { value: "desktop", label: <span className="inline-flex items-center gap-1.5"><Monitor className="h-3.5 w-3.5" /> Desktop</span> },
          { value: "mobile", label: <span className="inline-flex items-center gap-1.5"><Smartphone className="h-3.5 w-3.5" /> Mobile</span> },
        ]}
      />
      {pending && <Spinner className="h-4 w-4" />}
    </div>
  );
}
