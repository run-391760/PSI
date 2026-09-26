import { FolderKanban } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { database } from "@/lib/domain";
import type { Project } from "@/lib/projects";
import { DomainAvatar } from "@/components/seo/badges";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { NewProjectButton } from "./project-form";

/**
 * Shown by project-based tools when no ?project= is selected: lists the user's projects (each links
 * to `${basePath}?project=<id>`) and offers to create one.
 */
export function ProjectGate({
  projects,
  basePath,
  title,
  description,
  status,
  keep,
}: {
  projects: Project[];
  basePath: string;
  title: string;
  description: string;
  /** Optional per-project status line (e.g. "Last crawl 2d ago"). */
  status?: Record<string, ReactNode>;
  /** Extra query params to carry into the tool (e.g. { import: "kw1,kw2" }). */
  keep?: Record<string, string | undefined>;
}) {
  const extra = Object.entries(keep ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `&${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
    .join("");
  const redirectTo = `${basePath}?project={id}${extra}`;
  if (!projects.length)
    return (
      <Card>
        <EmptyState
          icon={<FolderKanban className="h-5 w-5" />}
          title={`Create a project to use ${title}`}
          description={description}
          action={<NewProjectButton redirectTo={redirectTo} />}
        />
      </Card>
    );
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold">Choose a project</h2>
          <p className="text-[12.5px] text-text-3">{description}</p>
        </div>
        <NewProjectButton redirectTo={redirectTo} variant="secondary" label="New project" />
      </div>
      <ul className="divide-y divide-border">
        {projects.map((p) => (
          <li key={p.id}>
            <Link href={`${basePath}?project=${p.id}${extra}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
              <DomainAvatar domain={p.domain} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-text">{p.name}</div>
                <div className="truncate text-[12.5px] text-text-3">
                  {p.domain} · {database(p.country).flag} {database(p.country).name} · {p.device}
                </div>
              </div>
              <div className="text-right text-[12.5px] text-text-2">{status?.[p.id] ?? <span className="text-link">Open →</span>}</div>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
