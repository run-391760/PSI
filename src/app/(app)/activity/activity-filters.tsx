"use client";

import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { JOB_STATUS, jobKindLabel } from "@/lib/reports/kinds";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { Select } from "@/components/ui/input";

/** URL-driven filters for the jobs table (status, tool, project). */
export function ActivityFilters({ modules, projects }: { modules: string[]; projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, start] = useTransition();
  const set = (key: string, value: string) => {
    const params = new URLSearchParams(search.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    start(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
  };
  const active = ["status", "tool", "project"].some((k) => search.get(k));
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
      <Select value={search.get("status") ?? ""} onChange={(e) => set("status", e.target.value)} className="h-8 w-full sm:w-40" aria-label="Filter by status">
        <option value="">All statuses</option>
        {Object.entries(JOB_STATUS).map(([id, s]) => (
          <option key={id} value={id}>
            {s.label}
          </option>
        ))}
      </Select>
      <Select value={search.get("tool") ?? ""} onChange={(e) => set("tool", e.target.value)} className="h-8 w-full sm:w-48" aria-label="Filter by tool">
        <option value="">All tools</option>
        {modules.map((m) => (
          <option key={m} value={m}>
            {jobKindLabel(`${m}.x`).tool}
          </option>
        ))}
      </Select>
      <Select value={search.get("project") ?? ""} onChange={(e) => set("project", e.target.value)} className="h-8 w-full sm:w-52" aria-label="Filter by project">
        <option value="">All projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      {active && (
        <Button size="sm" variant="ghost" onClick={() => start(() => router.push(`${pathname}${search.get("tab") ? `?tab=${search.get("tab")}` : ""}`, { scroll: false }))}>
          <X className="h-3.5 w-3.5" /> Clear filters
        </Button>
      )}
      {pending && <Spinner className="h-4 w-4" />}
    </div>
  );
}
