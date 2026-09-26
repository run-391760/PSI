import { FolderKanban } from "lucide-react";
import Link from "next/link";
import { database } from "@/lib/domain";
import { timeAgo } from "@/lib/format";
import type { Project } from "@/lib/projects";
import { DomainAvatar } from "@/components/seo/badges";
import { NewProjectButton } from "@/components/projects/project-form";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";

/**
 * Project chooser for Position Tracking. Like ProjectGate, but keeps extra query params (e.g. ?import=)
 * and shows each project's tracking status.
 */
export function ProjectPicker({ projects, status, extra = "" }: { projects: Project[]; status: Map<string, { keywords: number; lastCheckAt: string | null }>; extra?: string }) {
  const redirectTo = `/position-tracking?project={id}${extra}`;
  if (!projects.length)
    return (
      <Card>
        <EmptyState
          icon={<FolderKanban className="h-5 w-5" />}
          title="Create a project to track rankings"
          description="Position Tracking monitors daily Google rankings of a project's domain and its competitors."
          action={
            <div className="text-left">
              <NewProjectButton redirectTo={redirectTo} />
            </div>
          }
        />
      </Card>
    );
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold">Choose a project</h2>
          <p className="text-[12.5px] text-text-3">Each project has one tracking campaign: keywords, competitors, device and location.</p>
        </div>
        <NewProjectButton redirectTo={redirectTo} variant="secondary" label="New project" />
      </div>
      <ul className="divide-y divide-border">
        {projects.map((p) => {
          const s = status.get(p.id);
          return (
            <li key={p.id}>
              <Link href={`/position-tracking?project=${p.id}${extra}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                <DomainAvatar domain={p.domain} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-text">{p.name}</div>
                  <div className="truncate text-[12.5px] text-text-3">
                    {p.domain} · {database(p.country).flag} {database(p.country).name}
                  </div>
                </div>
                <div className="shrink-0 text-right text-[12.5px]">
                  {s ? (
                    <>
                      <Badge tone="good">{s.keywords.toLocaleString()} keywords</Badge>
                      <div className="mt-0.5 text-text-3">{s.lastCheckAt ? `Updated ${timeAgo(s.lastCheckAt)}` : "First check pending"}</div>
                    </>
                  ) : (
                    <span className="text-link">Set up tracking →</span>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
