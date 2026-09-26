"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";

/** URL-driven notification filters (tool, severity, project, unread). */
export function NotificationFilters({ tools, projects }: { tools: { id: string; label: string; total: number }[]; projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, start] = useTransition();
  const set = (k: string, v: string) => {
    const params = new URLSearchParams(search.toString());
    if (v) params.set(k, v);
    else params.delete(k);
    params.delete("page");
    start(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
  };
  const active = ["tool", "severity", "project", "unread"].some((k) => search.get(k));
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3">
      <Segmented
        options={[
          { value: "", label: "All" },
          { value: "1", label: "Unread" },
        ]}
        value={search.get("unread") ?? ""}
        onChange={(v) => set("unread", v)}
      />
      <Select value={search.get("tool") ?? ""} onChange={(e) => set("tool", e.target.value)} className="h-8 w-auto text-[12.5px]" aria-label="Tool">
        <option value="">All tools</option>
        {tools.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label} ({t.total})
          </option>
        ))}
      </Select>
      <Select value={search.get("severity") ?? ""} onChange={(e) => set("severity", e.target.value)} className="h-8 w-auto text-[12.5px]" aria-label="Severity">
        <option value="">All severities</option>
        <option value="critical">Critical</option>
        <option value="warning">Warning</option>
        <option value="success">Success</option>
        <option value="info">Info</option>
      </Select>
      <Select value={search.get("project") ?? ""} onChange={(e) => set("project", e.target.value)} className="h-8 w-auto max-w-56 text-[12.5px]" aria-label="Project">
        <option value="">All projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      {active && (
        <Button size="sm" variant="ghost" onClick={() => start(() => router.push(`${pathname}${search.get("tab") ? `?tab=${search.get("tab")}` : ""}`, { scroll: false }))}>
          Clear filters
        </Button>
      )}
      {pending && <Spinner className="h-3.5 w-3.5" />}
    </div>
  );
}
