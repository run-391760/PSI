import { Send } from "lucide-react";
import { Page, PageHeader } from "@/components/shell/page";
import { NewProjectButton } from "@/components/projects/project-form";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { TabsNav } from "@/components/ui/tabs";
import { STATUS_LABEL, STATUS_TONE, pubChannel, type PostStatus } from "@/lib/cx/publishing/core";
import { cn } from "@/lib/utils";

export function NoBrand({ title, section = "Publishing", redirect = "/cx/publishing" }: { title: string; section?: string; redirect?: string }) {
  return (
    <Page>
      <PageHeader title={title} breadcrumbs={[{ label: "CX" }, { label: section }]} />
      <Card>
        <EmptyState
          icon={<Send className="h-5 w-5" />}
          title="Create a brand to start publishing"
          description="A brand is one of your projects. Plan, approve and schedule posts for its social channels, track short-link clicks and see channel analytics."
          action={<NewProjectButton redirectTo={`${redirect}?brand={id}`} label="Create brand" />}
        />
      </Card>
    </Page>
  );
}

export function PubNav({ brandId, pending }: { brandId: string; pending?: number }) {
  const q = `brand=${brandId}`;
  return (
    <TabsNav
      className="mb-5"
      items={[
        { href: `/cx/publishing?${q}`, label: "Posts" },
        { href: `/cx/publishing?${q}&tab=approvals`, label: "Approvals", count: pending ? pending : undefined },
        { href: `/cx/publishing/calendar?${q}`, label: "Calendar" },
        { href: `/cx/publishing/assets?${q}`, label: "Assets" },
        { href: `/cx/publishing?${q}&tab=links`, label: "Links" },
        { href: `/cx/publishing?${q}&tab=settings`, label: "Channels & roles" },
      ]}
    />
  );
}

const MARK: Record<string, string> = { facebook: "f", instagram: "IG", linkedin: "in", x: "X", youtube: "YT", threads: "@", gbp: "G" };

/** Neutral channel mark (no third-party logos). */
export function ChannelChip({ kind, className, withName }: { kind: string; className?: string; withName?: boolean }) {
  const name = pubChannel(kind)?.name ?? kind;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[12px] text-text-2", className)} title={name}>
      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-strong bg-surface-2 px-1 text-[10px] font-bold text-text">{MARK[kind] ?? kind.slice(0, 2)}</span>
      {withName && name}
    </span>
  );
}

export function StatusBadge({ status }: { status: PostStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
