import { AtSign, Camera, Cloud, FileText, Globe, Hash, Inbox, Mail, MessageCircle, MessagesSquare, Newspaper, Phone, Rss, Share2, Smartphone, Star, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, type Tone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import { NewProjectButton } from "@/components/projects/project-form";
import { Page, PageHeader } from "@/components/shell/page";
import { channelInfo } from "@/lib/cx/channels";
import { CRM_STATUSES, crmLabel } from "@/lib/cx/inbox/model";
import { cn } from "@/lib/utils";

/** Shared, server-safe bits of the CX inbox module. */
const ICONS: Record<string, typeof Mail> = {
  email: Mail, livechat: MessagesSquare, webform: FileText, whatsapp: MessageCircle, facebook: Share2, instagram: Camera, x: AtSign, linkedin: Users,
  youtube: Globe, reddit: Hash, news: Newspaper, hackernews: Rss, bluesky: Cloud, mastodon: Hash, appstore: Smartphone, playstore: Smartphone, "google-reviews": Star, phone: Phone,
};
export function ChannelIcon({ kind, className }: { kind: string; className?: string }) {
  const I = ICONS[kind] ?? Inbox;
  return <I className={cn("h-3.5 w-3.5 shrink-0", className)} aria-hidden />;
}
export const channelLabel = (kind: string) => channelInfo(kind)?.name ?? (kind === "phone" ? "Phone" : kind === "other" ? "Other" : kind);

export const STATUS_TONE: Record<string, Tone> = {
  new: "brand", open: "info", assigned: "info", wip: "serious", responded: "neutral", reopened: "critical", follow_up: "warning", pending: "warning", on_hold: "neutral", solved: "good", closed: "neutral", ignored: "neutral",
};
export const PRIORITY_TONE: Record<string, Tone> = { low: "neutral", normal: "neutral", high: "warning", urgent: "critical" };
export const SENTIMENT_TONE: Record<string, Tone> = { positive: "good", neutral: "neutral", negative: "critical", mixed: "warning" };
export const statusLabel = (s: string) => crmLabel(s);

/** CRM status badge (WIP, Follow-up, Reopened, Ignored… see model.CRM_STATUSES). */
export const StatusBadge = ({ status }: { status: string }) => <Badge tone={STATUS_TONE[status] ?? "neutral"} title={CRM_STATUSES.find((x) => x.id === status)?.hint}>{statusLabel(status)}</Badge>;
export const PriorityBadge = ({ priority }: { priority: string }) => (priority === "normal" ? null : <Badge tone={PRIORITY_TONE[priority]}>{priority[0].toUpperCase() + priority.slice(1)}</Badge>);
export const SentimentBadge = ({ sentiment }: { sentiment: string | null }) => (sentiment ? <Badge tone={SENTIMENT_TONE[sentiment] ?? "neutral"}>{sentiment[0].toUpperCase() + sentiment.slice(1)}</Badge> : null);

export function NoBrand({ title, breadcrumbs, redirect }: { title: string; breadcrumbs: { label: string; href?: string }[]; redirect: string }) {
  return (
    <Page>
      <PageHeader title={title} breadcrumbs={breadcrumbs} />
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState title="Create a brand first" description="A CX brand is one of your projects. Create one to connect channels and start receiving conversations." action={<NewProjectButton redirectTo={`${redirect}?brand={id}`} />} />
      </div>
    </Page>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = (name || "?").split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
  return <span className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[12px] font-semibold text-link", className)} aria-hidden>{initials}</span>;
}

export function KeyValue({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-[12.5px]">
      <span className="shrink-0 text-text-3">{label}</span>
      <span className="min-w-0 text-right text-text">{children}</span>
    </div>
  );
}
