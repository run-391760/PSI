import { AtSign, Cloud, MessagesSquare, Newspaper, Play, Smartphone, Terminal, Radio } from "lucide-react";
import { sourceLabel } from "@/lib/cx/listening/sources";
import { cn } from "@/lib/utils";

const ICONS: Record<string, typeof Newspaper> = { news: Newspaper, hackernews: Terminal, mastodon: AtSign, appstore: Smartphone, reddit: MessagesSquare, youtube: Play, bluesky: Cloud };

/** Neutral source glyph with an accessible label (no brand logos). */
export function SourceIcon({ source, className, withLabel }: { source: string; className?: string; withLabel?: boolean }) {
  const Icon = ICONS[source] ?? Radio;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-text-2", className)} title={sourceLabel(source)}>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      {withLabel ? <span className="text-[12.5px]">{sourceLabel(source)}</span> : <span className="sr-only">{sourceLabel(source)}</span>}
    </span>
  );
}
