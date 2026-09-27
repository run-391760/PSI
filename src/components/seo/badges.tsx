import {
  ArrowDown,
  ArrowUp,
  Bot,
  Image as ImageIcon,
  LayoutList,
  Link2,
  MapPin,
  MessageCircleQuestion,
  MessagesSquare,
  Minus,
  Newspaper,
  PlayCircle,
  Quote,
  Search,
  ShoppingCart,
  Sparkles,
  Star,
  BadgeDollarSign,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SERP_FEATURES, type Intent, type SerpFeature } from "@/lib/seo/types";
import { Tooltip } from "@/components/ui/tooltip";

// ---------------------------------------------------------------- Keyword difficulty

export const KD_BANDS = [
  { max: 14, label: "Very easy", color: "#0ca30c", note: "Your best chance to rank for a new page without backlinks." },
  { max: 29, label: "Easy", color: "#6cbf3a", note: "You'll need quality content focused on the keyword's intent." },
  { max: 49, label: "Possible", color: "#fab219", note: "You'll need well-structured, unique content." },
  { max: 69, label: "Difficult", color: "#ec835a", note: "You'll need referring domains and optimized content." },
  { max: 84, label: "Hard", color: "#d03b3b", note: "Many referring domains and well-optimized content are needed." },
  { max: 100, label: "Very hard", color: "#a51d1d", note: "Takes a lot of on-page SEO, link building and content promotion." },
];
export const kdBand = (kd: number) => KD_BANDS.find((b) => kd <= b.max) ?? KD_BANDS[KD_BANDS.length - 1];

export function KdBadge({ kd, showLabel }: { kd: number | null | undefined; showLabel?: boolean }) {
  if (kd == null) return <span className="text-text-3">n/a</span>;
  const band = kdBand(kd);
  return (
    <Tooltip content={`${band.label}: ${band.note}`}>
      <span className="tabular inline-flex items-center gap-1.5">
        <span>{kd}</span>
        <span className="h-2 w-2 rounded-full" style={{ background: band.color }} aria-hidden />
        {showLabel && <span className="text-text-3">{band.label}</span>}
      </span>
    </Tooltip>
  );
}

// ---------------------------------------------------------------- Intent

export const INTENT_META: Record<Intent, { letter: string; label: string; cls: string; note: string }> = {
  informational: { letter: "I", label: "Informational", cls: "bg-[#e3effc] text-[#1f5fae] dark:bg-[#15294a] dark:text-[#8fbaf5]", note: "The user wants to find an answer to a specific question." },
  navigational: { letter: "N", label: "Navigational", cls: "bg-[#ece8fd] text-[#4a36b3] dark:bg-[#251f4a] dark:text-[#b4a9ff]", note: "The user wants to find a specific page or site." },
  commercial: { letter: "C", label: "Commercial", cls: "bg-[#fdf1d9] text-[#8a5a00] dark:bg-[#352914] dark:text-[#f5c565]", note: "The user wants to investigate brands or services." },
  transactional: { letter: "T", label: "Transactional", cls: "bg-[#dcf3e6] text-[#0d6b3a] dark:bg-[#12301f] dark:text-[#6fd39a]", note: "The user wants to complete an action (conversion)." },
};

export function IntentBadges({ intents, full }: { intents: Intent[]; full?: boolean }) {
  return (
    <span className="inline-flex gap-1">
      {intents.map((i) => (
        <Tooltip key={i} content={`${INTENT_META[i].label}: ${INTENT_META[i].note}`}>
          <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[11px] font-semibold", INTENT_META[i].cls)}>{full ? INTENT_META[i].label : INTENT_META[i].letter}</span>
        </Tooltip>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- SERP features

const FEATURE_ICONS: Record<SerpFeature, ReactNode> = {
  ai_overview: <Sparkles className="h-3.5 w-3.5" />,
  featured_snippet: <Quote className="h-3.5 w-3.5" />,
  people_also_ask: <MessageCircleQuestion className="h-3.5 w-3.5" />,
  local_pack: <MapPin className="h-3.5 w-3.5" />,
  image_pack: <ImageIcon className="h-3.5 w-3.5" />,
  video: <PlayCircle className="h-3.5 w-3.5" />,
  top_stories: <Newspaper className="h-3.5 w-3.5" />,
  shopping: <ShoppingCart className="h-3.5 w-3.5" />,
  reviews: <Star className="h-3.5 w-3.5" />,
  sitelinks: <Link2 className="h-3.5 w-3.5" />,
  knowledge_panel: <LayoutList className="h-3.5 w-3.5" />,
  ads_top: <BadgeDollarSign className="h-3.5 w-3.5" />,
  discussions: <MessagesSquare className="h-3.5 w-3.5" />,
  related_searches: <Search className="h-3.5 w-3.5" />,
};
export const featureLabel = (f: SerpFeature) => SERP_FEATURES.find((x) => x.id === f)?.label ?? f;
export const FeatureIcon = ({ feature }: { feature: SerpFeature }) => <>{FEATURE_ICONS[feature]}</>;

/** SERP feature icons. `owned` features (where the domain appears) are highlighted. */
export function SerpFeatureIcons({ features, owned = [], max = 5 }: { features: SerpFeature[]; owned?: SerpFeature[]; max?: number }) {
  const list = features.filter((f) => f !== "related_searches");
  const shown = list.slice(0, max);
  return (
    <span className="inline-flex items-center gap-1 text-text-3">
      {shown.map((f) => (
        <Tooltip key={f} content={`${featureLabel(f)}${owned.includes(f) ? " — the domain appears here" : ""}`}>
          <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded", owned.includes(f) ? "bg-brand-soft text-brand-ink" : "")}>{FEATURE_ICONS[f]}</span>
        </Tooltip>
      ))}
      {list.length > max && <span className="text-[11px]">+{list.length - max}</span>}
    </span>
  );
}

export function AiIcon() {
  return <Bot className="h-3.5 w-3.5" />;
}

// ---------------------------------------------------------------- Positions

/** Position change: previous → current. Positive = improved. */
export function PositionChange({ previous, current, compact }: { previous: number | null | undefined; current: number | null | undefined; compact?: boolean }) {
  if (current == null && previous != null) return <span className="text-[12px] font-medium text-critical-ink">Lost</span>;
  if (previous == null && current != null) return <span className="rounded bg-brand-soft px-1 text-[11px] font-semibold text-brand-ink">New</span>;
  if (previous == null || current == null) return <span className="text-text-3">–</span>;
  // Search Console positions are fractional averages: round the change to one decimal.
  const d = Math.round((previous - current) * 10) / 10;
  if (d === 0)
    return (
      <span className="inline-flex items-center text-text-3" aria-label="No change">
        {compact ? <Minus className="h-3 w-3" /> : "0"}
      </span>
    );
  return (
    <span className={cn("tabular inline-flex items-center text-[12.5px] font-medium", d > 0 ? "text-good-ink" : "text-critical-ink")}>
      {d > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(d)}
    </span>
  );
}

// ---------------------------------------------------------------- Trend bars

/** Tiny column chart of 12 monthly values (keyword trend). Server-safe SVG. */
export function TrendBars({ values, width = 64, height = 18, color = "var(--series-1)" }: { values: number[]; width?: number; height?: number; color?: string }) {
  const max = Math.max(...values, 1);
  const bw = width / values.length;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Trend: ${values.join(", ")}`}>
      {values.map((v, i) => {
        const h = Math.max(1.5, (v / max) * height);
        return <rect key={i} x={i * bw + 0.5} y={height - h} width={Math.max(1, bw - 1.5)} height={h} rx={1} fill={color} opacity={i === values.length - 1 ? 1 : 0.55} />;
      })}
    </svg>
  );
}

/** Sparkline (line). Server-safe SVG. */
export function Sparkline({ values, width = 80, height = 24, color = "var(--series-1)", fill = true }: { values: number[]; width?: number; height?: number; color?: string; fill?: boolean }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 4) + 2, height - 3 - ((v - min) / span) * (height - 6)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      {fill && <path d={`${d} L${last[0]},${height} L${pts[0][0]},${height} Z`} fill={color} opacity={0.1} />}
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} stroke="var(--surface)" strokeWidth={1.5} />
    </svg>
  );
}

// ---------------------------------------------------------------- Domains

const AVATAR_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#4a3aa7", "#e34948", "#008300", "#c98500", "#d55181"];
export function DomainAvatar({ domain, size = 18 }: { domain: string; size?: number }) {
  let h = 0;
  for (const c of domain) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded font-semibold text-white uppercase"
      style={{ width: size, height: size, fontSize: size * 0.55, background: AVATAR_COLORS[h % AVATAR_COLORS.length] }}
    >
      {domain.replace(/^www\./, "")[0]}
    </span>
  );
}

/** Domain name that links to Domain Overview. */
export function DomainLink({ domain, db, className, avatar = true }: { domain: string; db?: string; className?: string; avatar?: boolean }) {
  return (
    <Link href={`/domain-overview?q=${encodeURIComponent(domain)}${db ? `&db=${db}` : ""}`} className={cn("inline-flex min-w-0 items-center gap-1.5 text-link hover:underline", className)}>
      {avatar && <DomainAvatar domain={domain} />}
      <span className="truncate">{domain}</span>
    </Link>
  );
}

/** Keyword that links to Keyword Overview. */
export function KeywordLink({ keyword, db, className }: { keyword: string; db?: string; className?: string }) {
  return (
    <Link href={`/keyword-overview?q=${encodeURIComponent(keyword)}${db ? `&db=${db}` : ""}`} className={cn("text-link hover:underline", className)}>
      {keyword}
    </Link>
  );
}

/** Authority Score pill. */
export function AsBadge({ score }: { score: number }) {
  return (
    <Tooltip content="Authority Score (0–100): overall quality and SEO performance of a domain.">
      <span className="tabular inline-flex h-5 min-w-7 items-center justify-center rounded border border-border-strong px-1 text-[11.5px] font-semibold text-text">{score}</span>
    </Tooltip>
  );
}
