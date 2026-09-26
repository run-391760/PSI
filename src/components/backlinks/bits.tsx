import { ExternalLink, Star } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { database } from "@/lib/domain";
import { dateLabel, dateTimeLabel, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DomainAvatar } from "@/components/seo/badges";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";

/** Domain that opens Backlink Analytics for it (plus an external-site icon). Server-safe. */
export function BlDomainLink({ domain, className, external = true }: { domain: string; className?: string; external?: boolean }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <DomainAvatar domain={domain} />
      <Link href={`/backlink-analytics?q=${encodeURIComponent(domain)}`} className="truncate text-link hover:underline">
        {domain}
      </Link>
      {external && (
        <a href={`https://${domain}`} target="_blank" rel="noopener noreferrer" className="shrink-0 text-text-3 hover:text-text" aria-label={`Open ${domain}`}>
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </span>
  );
}

export function CountryLabel({ code, short }: { code: string; short?: boolean }) {
  if (!code) return <span className="text-text-3">n/a</span>;
  const info = database(code);
  const known = info.code === code.toUpperCase();
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {known && <span aria-hidden>{info.flag}</span>}
      <span>{short || !known ? code.toUpperCase() : info.name}</span>
    </span>
  );
}

export const shortDate = (d: string | null | undefined) => (d ? dateLabel(d) : "n/a");

/** Link attribute badges (Follow / Nofollow / UGC / Sponsored). */
export function RelBadges({ rel, follow }: { rel: string[]; follow: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {follow && !rel.length && <Badge tone="good">Follow</Badge>}
      {rel.includes("nofollow") && <Badge>Nofollow</Badge>}
      {rel.includes("ugc") && <Badge tone="info">UGC</Badge>}
      {rel.includes("sponsored") && <Badge tone="warning">Sponsored</Badge>}
      {follow && rel.length > 0 && !rel.includes("nofollow") && <Badge tone="good">Follow</Badge>}
    </span>
  );
}

export function NewLostBadge({ isNew, isLost }: { isNew?: boolean; isLost?: boolean }) {
  if (isLost) return <Badge tone="critical">Lost</Badge>;
  if (isNew) return <Badge tone="brand">New</Badge>;
  return null;
}

/** 1–5 star rating with an optional tooltip explaining the reason. */
export function Stars({ value, reason, size = 14 }: { value: number; reason?: string; size?: number }) {
  const stars = (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} style={{ width: size, height: size }} className={i <= value ? "fill-[var(--warning)] text-[var(--warning)]" : "text-border-strong"} aria-hidden />
      ))}
    </span>
  );
  return reason ? <Tooltip content={reason}>{stars}</Tooltip> : stars;
}

/** Horizontal share list (label · bar · value · %). Server-safe. */
export function ShareList({ items, format, color = "var(--series-1)", labelWidth = "w-32" }: { items: { label: ReactNode; value: number; share: number; key?: string }[]; format: (v: number) => string; color?: string; labelWidth?: string }) {
  const max = Math.max(...items.map((i) => i.share), 1);
  return (
    <ul className="space-y-2">
      {items.map((it, idx) => (
        <li key={it.key ?? idx} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2.5 text-[13px]">
          <span className={cn("truncate text-text-2", labelWidth)}>{it.label}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <span className="block h-full rounded-full" style={{ width: `${(it.share / max) * 100}%`, background: color }} />
          </span>
          <span className="tabular w-14 text-right font-medium text-text">{format(it.value)}</span>
          <span className="tabular w-12 text-right text-[12px] text-text-3">{it.share.toFixed(1)}%</span>
        </li>
      ))}
    </ul>
  );
}

/** Relative time ("5m ago"); safe to render in client components (server and client clocks differ). */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} title={dateTimeLabel(iso)} className={className} suppressHydrationWarning>
      {timeAgo(iso)}
    </time>
  );
}
