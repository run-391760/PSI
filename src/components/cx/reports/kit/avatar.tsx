"use client";

import { AtSign, ClipboardList, Cloud, Globe, Mail, MessageCircle, MessagesSquare, Newspaper, Phone, Play, Radio, Send, Smartphone, Star, Terminal, Users, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { NetworkIcon } from "@/components/cx/network-icon";

/** Neutral network glyphs (no brand logos). */
const ICONS: Record<string, LucideIcon> = {
  news: Newspaper, hackernews: Terminal, forums: Terminal, mastodon: AtSign, bluesky: Cloud, appstore: Smartphone, playstore: Smartphone, app_reviews: Smartphone,
  reddit: MessagesSquare, youtube: Play, email: Mail, livechat: MessageCircle, webform: Globe, phone: Phone, whatsapp: MessageCircle, telegram: Send,
  discord: MessagesSquare, discourse: MessagesSquare, x: AtSign, facebook: Users, instagram: Users, linkedin: Users, "google-reviews": Star, google_reviews: Star,
  task: ClipboardList, survey: Star,
};
export const NETWORK_LABEL: Record<string, string> = {
  news: "News", hackernews: "Hacker News", mastodon: "Mastodon", bluesky: "Bluesky", appstore: "App Store", playstore: "Play Store", reddit: "Reddit", youtube: "YouTube",
  email: "Email", livechat: "Live chat", webform: "Web form", phone: "Phone", whatsapp: "WhatsApp", telegram: "Telegram", discord: "Discord", discourse: "Forum",
  x: "X / Twitter", facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", "google-reviews": "Google reviews", task: "Task", survey: "Survey",
};
export const networkLabel = (n: string) => NETWORK_LABEL[n] ?? n.replace(/[-_]/g, " ");

export function NetworkGlyph({ network, className }: { network: string; className?: string }) {
  const Icon = ICONS[network] ?? Radio;
  return <Icon className={className} aria-hidden />;
}

/** Avatar (image or initials) with a small network badge at the bottom-left. */
export function NetworkAvatar({ name, src, network, size = 36 }: { name: string; src?: string | null; network: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initials = name.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} title={networkLabel(network)}>
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full rounded-full border border-border object-cover" onError={() => setBroken(true)} referrerPolicy="no-referrer" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full border border-border bg-surface-3 text-[12px] font-semibold text-text-2">{initials}</span>
      )}
      <span className={cn("absolute -bottom-0.5 -left-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-surface bg-brand text-white")}>
        {network === "task" || network === "survey" ? <NetworkGlyph network={network} className="h-2.5 w-2.5" /> : <NetworkIcon kind={network} className="h-2.5 w-2.5" />}
      </span>
      <span className="sr-only">{networkLabel(network)}</span>
    </span>
  );
}

