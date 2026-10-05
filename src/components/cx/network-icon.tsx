import { AtSign, Cloud, FileText, Globe, Hash, Inbox, Mail, MessageCircle, MessagesSquare, Newspaper, Phone, Rss, Send, Smartphone, Star, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Network glyph for a channel / listening-source kind (instagram, facebook, x, linkedin, youtube, email,
 * news…). Monochrome (currentColor), server-safe. Used by the scope picker and the shell; other CX
 * modules may import it for profile badges.
 */
const svg = (children: ReactNode) =>
  function Glyph({ className }: { className?: string }) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
        {children}
      </svg>
    );
  };

const Facebook = svg(<path d="M15 3h-2.5A3.5 3.5 0 0 0 9 6.5V10H6.5v3.5H9V21h3.5v-7.5H15l.5-3.5h-3V7a1 1 0 0 1 1-1H15z" />);
const Instagram = svg(
  <>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r=".6" fill="currentColor" />
  </>,
);
const LinkedIn = svg(
  <>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="M8 10.5V17M8 7.5v.01M12 17v-6.5M12 13.5a2.5 2.5 0 0 1 5 0V17" />
  </>,
);
const XGlyph = svg(<path d="M4 4l16 16M20 4L4 20" />);
const YouTube = svg(
  <>
    <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
    <path d="M10.5 9.5v5l4-2.5z" fill="currentColor" />
  </>,
);
const Reddit = svg(
  <>
    <ellipse cx="12" cy="14.5" rx="7.5" ry="5" />
    <path d="M12 9.5 13.5 4l4 1M9.5 14v.01M14.5 14v.01M9.5 16.5c1.5 1 3.5 1 5 0" />
    <circle cx="18.5" cy="5" r="1.2" />
  </>,
);

const ICONS: Record<string, LucideIcon | ReturnType<typeof svg>> = {
  facebook: Facebook,
  instagram: Instagram,
  linkedin: LinkedIn,
  x: XGlyph,
  twitter: XGlyph,
  youtube: YouTube,
  reddit: Reddit,
  email: Mail,
  livechat: MessagesSquare,
  webform: FileText,
  whatsapp: MessageCircle,
  telegram: Send,
  discord: MessagesSquare,
  discourse: MessagesSquare,
  threads: AtSign,
  news: Newspaper,
  hackernews: Rss,
  bluesky: Cloud,
  mastodon: Hash,
  appstore: Smartphone,
  playstore: Smartphone,
  "google-reviews": Star,
  gbp: Star,
  phone: Phone,
  web: Globe,
};

export function NetworkIcon({ kind, className }: { kind: string; className?: string }) {
  const I = ICONS[kind] ?? Inbox;
  return <I className={cn("h-3.5 w-3.5 shrink-0", className)} />;
}
