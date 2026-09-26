"use client";

import { useRouter } from "next/navigation";

/** Jump to another project's dashboard (keeps the current tab). */
export function ProjectJump({ projects, current, tab }: { projects: { id: string; name: string; domain: string }[]; current: string; tab?: string }) {
  const router = useRouter();
  return (
    <select
      value={current}
      onChange={(e) => router.push(`/projects/${e.target.value}${tab && tab !== "overview" ? `?tab=${tab}` : ""}`)}
      className="h-8.5 max-w-52 rounded-md border border-border-strong bg-surface px-2 text-[13px] text-text shadow-card focus:border-brand focus:outline-none"
      aria-label="Switch project"
    >
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} ({p.domain})
        </option>
      ))}
    </select>
  );
}
