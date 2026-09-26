"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/** Switch the active ?project= of a project-based tool, keeping the current path. */
export function ProjectSwitcher({ projects, current, className }: { projects: { id: string; name: string; domain: string }[]; current: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  return (
    <select
      value={current}
      onChange={(e) => {
        const params = new URLSearchParams(search.toString());
        params.set("project", e.target.value);
        router.push(`${pathname}?${params.toString()}`);
      }}
      className={cn("h-8 max-w-60 rounded-md border border-border-strong bg-surface px-2 text-[13px] focus:outline-none", className)}
      aria-label="Project"
    >
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} ({p.domain})
        </option>
      ))}
    </select>
  );
}
