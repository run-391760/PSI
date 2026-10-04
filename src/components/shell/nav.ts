import {
  Activity,
  AlignLeft,
  BarChart3,
  Bell,
  Bot,
  Building2,
  ChartNoAxesCombined,
  Compass,
  FileCheck2,
  FileSearch,
  FileText,
  FolderKanban,
  Gauge,
  Globe,
  LayoutDashboard,
  LineChart,
  Layers,
  Link2,
  ListTree,
  MapPinned,
  Megaphone,
  MessageSquareQuote,
  Network,
  PenLine,
  Radar,
  ScrollText,
  Search,
  ShieldAlert,
  Sparkles,
  Star,
  Swords,
  Target,
  TrendingUp,
  Unlink,
  Wand2,
  type LucideIcon,
} from "lucide-react";

import type { Provider } from "@/lib/data-mode";

/** `requires`: providers that can power the tool (any one is enough). Omitted = works without an API. */
/** `defaultHidden`: not in the sidebar unless the user shows it via "Customize menu" (still in search). */
export type NavItem = { href: string; label: string; icon: LucideIcon; description: string; badge?: string; requires?: Provider[]; defaultHidden?: boolean };
export type NavGroup = { id: string; label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    id: "home",
    label: "",
    items: [
      { href: "/dashboard", label: "Home", icon: LayoutDashboard, description: "Search anything and see your projects at a glance." },
      { href: "/projects", label: "Projects", icon: FolderKanban, description: "Set up and monitor your sites." },
    ],
  },
  {
    id: "competitive",
    label: "Competitive research",
    items: [
      { href: "/domain-overview", label: "Domain Overview", icon: Globe, description: "Authority, organic and paid traffic, backlinks and competitors for any domain.", requires: ["dataforseo", "google"] },
      { href: "/traffic-analytics", label: "Traffic Analytics", icon: ChartNoAxesCombined, description: "Estimated visits, channels, engagement and audience of any website.", requires: ["clickstream", "google"] },
      { href: "/organic-research", label: "Organic Research", icon: TrendingUp, description: "Keywords, positions, pages and competitors in organic search.", requires: ["dataforseo", "google"] },
      { href: "/keyword-gap", label: "Keyword Gap", icon: Swords, description: "Compare keyword profiles of up to 5 domains.", requires: ["dataforseo"] },
      { href: "/backlink-gap", label: "Backlink Gap", icon: Unlink, description: "Find domains that link to competitors but not to you.", requires: ["dataforseo"] },
      { href: "/market-explorer", label: "Market Explorer", icon: Compass, description: "Market size, share of traffic and growth quadrant for a niche.", requires: ["dataforseo"] },
    ],
  },
  {
    id: "keywords",
    label: "Keyword research",
    items: [
      { href: "/keyword-overview", label: "Keyword Overview", icon: Search, description: "Volume, difficulty, intent, trend and SERP for a keyword.", requires: ["dataforseo"] },
      { href: "/keyword-magic-tool", label: "Keyword Magic Tool", icon: Wand2, description: "Thousands of keyword ideas grouped by topic." },
      { href: "/keyword-strategy", label: "Keyword Strategy Builder", icon: ListTree, description: "Keyword lists, clustering and pillar-page planning." },
      { href: "/position-tracking", label: "Position Tracking", icon: Target, description: "Daily rankings, visibility and share of voice.", requires: ["dataforseo", "google"] },
      { href: "/organic-traffic-insights", label: "Organic Traffic Insights", icon: LineChart, description: "Your real Search Console and GA4 data by landing page and query.", requires: ["google"] },
    ],
  },
  {
    id: "links",
    label: "Link building",
    items: [
      { href: "/backlink-analytics", label: "Backlink Analytics", icon: Link2, description: "Backlinks, referring domains, anchors and link velocity.", requires: ["dataforseo"] },
      { href: "/backlink-audit", label: "Backlink Audit", icon: ShieldAlert, description: "Find toxic links and build a disavow file.", requires: ["dataforseo"] },
      { href: "/link-building", label: "Link Building Tool", icon: Network, description: "Prospects, outreach pipeline and acquired links." },
      { href: "/bulk-analysis", label: "Bulk Analysis", icon: Layers, description: "Compare backlink profiles of up to 200 targets.", requires: ["dataforseo"] },
    ],
  },
  {
    id: "onpage",
    label: "On page & tech SEO",
    items: [
      { href: "/site-audit", label: "Site Audit", icon: Gauge, description: "Crawl your site and fix 100+ technical issues." },
      { href: "/on-page-checker", label: "On Page SEO Checker", icon: FileCheck2, description: "Page-level optimization ideas from top-10 rivals." },
      { href: "/seo-content-template", label: "SEO Content Template", icon: FileText, description: "Content brief from the top 10 results.", requires: ["dataforseo"] },
      { href: "/log-file-analyzer", label: "Log File Analyzer", icon: ScrollText, description: "How search bots crawl your site, from access logs." },
    ],
  },
  {
    id: "local",
    label: "Local SEO",
    items: [
      { href: "/local/listings", label: "Listing Management", icon: Building2, description: "Business listings across directories.", requires: ["business-profile"] },
      { href: "/local/map-rank-tracker", label: "Map Rank Tracker", icon: MapPinned, description: "Local pack rankings on a geo-grid.", requires: ["dataforseo", "business-profile"] },
      { href: "/local/reviews", label: "Review Management", icon: Star, description: "Reviews, ratings and responses.", requires: ["business-profile", "dataforseo"] },
    ],
  },
  {
    id: "content",
    label: "Content marketing",
    items: [
      { href: "/topic-research", label: "Topic Research", icon: Sparkles, description: "Content ideas, headlines and questions for a topic.", requires: ["dataforseo"] },
      { href: "/writing-assistant", label: "SEO Writing Assistant", icon: PenLine, description: "Readability, SEO and tone checks while you write." },
      { href: "/brand-monitoring", label: "Brand Monitoring", icon: MessageSquareQuote, description: "Mentions of your brand across the web." },
    ],
  },
  {
    id: "ai",
    label: "AI search",
    items: [{ href: "/ai-visibility", label: "AI Visibility", icon: Bot, description: "Brand mentions and citations in AI answers.", badge: "New", requires: ["ai", "dataforseo"] }],
  },
  {
    id: "ads",
    label: "Advertising",
    items: [
      { href: "/advertising-research", label: "Advertising Research", icon: Megaphone, description: "Competitors' paid keywords, ads and budgets.", requires: ["dataforseo"] },
      { href: "/ppc-keyword-tool", label: "PPC Keyword Tool", icon: AlignLeft, description: "Plan ad groups with CPC and competition.", requires: ["dataforseo"] },
    ],
  },
  {
    id: "monitor",
    label: "Monitoring & reports",
    items: [
      { href: "/sensor", label: "SERP Sensor", icon: Radar, description: "Google SERP volatility by category.", requires: ["dataforseo"] },
      { href: "/alerts", label: "Alerts", icon: Bell, description: "Ranking, audit and mention alerts." },
      { href: "/reports", label: "My Reports", icon: BarChart3, description: "Build and export PDF reports." },
      { href: "/activity", label: "Activity", icon: Activity, description: "Background jobs and data usage." },
    ],
  },
];

export const ALL_TOOLS = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));
export const toolByHref = (href: string) => ALL_TOOLS.find((t) => href === t.href || href.startsWith(`${t.href}/`));
export { FileSearch };
