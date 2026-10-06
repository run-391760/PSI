import {
  Activity,
  AlignLeft,
  BarChart3,
  Bell,
  Bug,
  Bot,
  Building2,
  ChartNoAxesCombined,
  ClipboardCheck,
  Compass,
  FileCheck2,
  FileSearch,
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
  Radar,
  ScrollText,
  Search,
  Settings,
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
/** `short`: sidebar label when `label` does not fit the 220px menu (the full label stays in tooltips, search and Customize). It must be a substring of `label` (WCAG 2.5.3 Label in Name). */
export type NavItem = { href: string; label: string; short?: string; icon: LucideIcon; description: string; badge?: string; requires?: Provider[]; defaultHidden?: boolean };
/** `section`: the SEO sidebar section (NAV_SECTIONS id) the group sits under; `label` is then its sentence-case sub-heading. */
export type NavGroup = { id: string; label: string; items: NavItem[]; section?: string };
/** A collapsible SEO sidebar section (RESEARCH, OPTIMIZE…). Its open/collapsed state lives in UI prefs panels as `seo-nav.<id>`. */
export type NavSection = { id: string; label: string; collapsed?: boolean };

export const NAV_SECTIONS: NavSection[] = [
  { id: "research", label: "Research" },
  { id: "optimize", label: "Optimize" },
  { id: "links", label: "Links" },
  { id: "local", label: "Local", collapsed: true },
  { id: "monitor", label: "Monitor" },
];

/** UI prefs panel id holding a sidebar section's collapsed state. */
export const navSectionPanel = (id: string) => `seo-nav.${id}`;

/** Id of the unlabelled top group (Home, Projects, Pre-Publish Optimizer). */
export const NAV_HOME_GROUP = "seo-home";

/**
 * SEO workspace navigation. Group ids carry the `seo-` prefix because menu customisation (prefs.nav,
 * keyed by group id for ordering) is shared with the CX workspace.
 */
export const NAV: NavGroup[] = [
  {
    id: NAV_HOME_GROUP,
    label: "",
    items: [
      { href: "/dashboard", label: "Home", icon: LayoutDashboard, description: "Search anything and see your projects at a glance." },
      { href: "/projects", label: "Projects", icon: FolderKanban, description: "Set up and monitor your sites." },
      { href: "/optimizer", label: "Pre-Publish Optimizer", short: "Optimizer", icon: ClipboardCheck, description: "Audit, score and fix a draft before publishing: intent, quality, topical coverage, E-E-A-T, schema, content briefs.", badge: "New" },
    ],
  },
  {
    id: "seo-competitors",
    section: "research",
    label: "Competitors",
    items: [
      { href: "/domain-overview", label: "Domain Overview", icon: Globe, description: "Authority, organic and paid traffic, backlinks and competitors for any domain.", requires: ["dataforseo", "google"] },
      { href: "/organic-research", label: "Organic Research", icon: TrendingUp, description: "Keywords, positions, pages and competitors in organic search.", requires: ["dataforseo", "google"] },
      { href: "/keyword-gap", label: "Keyword Gap", icon: Swords, description: "Compare keyword profiles of up to 5 domains.", requires: ["dataforseo"] },
      { href: "/traffic-analytics", label: "Traffic Analytics", icon: ChartNoAxesCombined, description: "Estimated visits, channels, engagement and audience of any website.", requires: ["clickstream", "google"], defaultHidden: true },
      { href: "/market-explorer", label: "Market Explorer", icon: Compass, description: "Market size, share of traffic and growth quadrant for a niche.", requires: ["dataforseo"], defaultHidden: true },
    ],
  },
  {
    id: "seo-keywords",
    section: "research",
    label: "Keywords",
    items: [
      { href: "/keyword-overview", label: "Keyword Overview", icon: Search, description: "Volume, difficulty, intent, trend and SERP for a keyword.", requires: ["dataforseo"] },
      { href: "/keyword-magic-tool", label: "Keyword Magic Tool", icon: Wand2, description: "Thousands of keyword ideas grouped by topic.", requires: ["dataforseo"] },
      { href: "/keyword-strategy", label: "Keyword Strategy Builder", short: "Keyword Strategy", icon: ListTree, description: "Keyword lists, clustering and pillar-page planning.", requires: ["dataforseo"] },
      { href: "/topic-research", label: "Topic Research", icon: Sparkles, description: "Content ideas, headlines and questions for a topic.", requires: ["dataforseo"] },
    ],
  },
  {
    id: "seo-ads",
    section: "research",
    label: "Advertising",
    items: [
      { href: "/advertising-research", label: "Advertising Research", icon: Megaphone, description: "Competitors' paid keywords, ads and budgets.", requires: ["dataforseo"], defaultHidden: true },
      { href: "/ppc-keyword-tool", label: "PPC Keyword Tool", icon: AlignLeft, description: "Plan ad groups with CPC and competition.", requires: ["dataforseo"], defaultHidden: true },
    ],
  },
  {
    id: "seo-technical",
    section: "optimize",
    label: "Technical",
    items: [
      { href: "/site-audit", label: "Site Audit", icon: Gauge, description: "Crawl your site and fix 100+ technical issues." },
      { href: "/on-page-checker", label: "On Page SEO Checker", short: "On Page SEO", icon: FileCheck2, description: "Page-level optimization ideas for live pages from top-10 rivals.", requires: ["dataforseo"] },
      { href: "/log-file-analyzer", label: "Log File Analyzer", icon: ScrollText, description: "How search bots crawl your site, from access logs.", defaultHidden: true },
    ],
  },
  {
    id: "seo-links",
    section: "links",
    label: "",
    items: [
      { href: "/backlink-analytics", label: "Backlink Analytics", icon: Link2, description: "Backlinks, referring domains, anchors and link velocity.", requires: ["dataforseo"] },
      { href: "/backlink-gap", label: "Backlink Gap", icon: Unlink, description: "Find domains that link to competitors but not to you.", requires: ["dataforseo"] },
      { href: "/backlink-audit", label: "Backlink Audit", icon: ShieldAlert, description: "Find toxic links and build a disavow file.", requires: ["dataforseo"] },
      { href: "/link-building", label: "Link Building Tool", icon: Network, description: "Prospects, outreach pipeline and acquired links.", requires: ["dataforseo"] },
      { href: "/bulk-analysis", label: "Bulk Analysis", icon: Layers, description: "Compare backlink profiles of up to 200 targets.", requires: ["dataforseo"], defaultHidden: true },
    ],
  },
  {
    id: "seo-local",
    section: "local",
    label: "",
    items: [
      { href: "/local/map-rank-tracker", label: "Map Rank Tracker", icon: MapPinned, description: "Local pack rankings on a geo-grid.", requires: ["dataforseo", "business-profile"] },
      { href: "/local/listings", label: "Listing Management", icon: Building2, description: "Business listings across directories.", requires: ["business-profile"], defaultHidden: true },
      { href: "/local/reviews", label: "Review Management", icon: Star, description: "Reviews, ratings and responses.", requires: ["business-profile", "dataforseo"], defaultHidden: true },
    ],
  },
  {
    id: "seo-rankings",
    section: "monitor",
    label: "Rankings & visibility",
    items: [
      { href: "/position-tracking", label: "Position Tracking", icon: Target, description: "Daily rankings, visibility and share of voice.", requires: ["dataforseo", "google"] },
      { href: "/organic-traffic-insights", label: "Organic Traffic Insights", short: "Traffic Insights", icon: LineChart, description: "Your real Search Console and GA4 data by landing page and query.", requires: ["google"] },
      { href: "/ai-visibility", label: "AI Visibility", icon: Bot, description: "Brand mentions and citations in AI answers.", badge: "New", requires: ["ai", "dataforseo"] },
      { href: "/sensor", label: "SERP Sensor", icon: Radar, description: "Google SERP volatility by category.", requires: ["dataforseo"], defaultHidden: true },
      { href: "/brand-monitoring", label: "Brand Monitoring", icon: MessageSquareQuote, description: "Mentions of your brand in the news.", defaultHidden: true },
    ],
  },
  {
    id: "seo-reports",
    section: "monitor",
    label: "Reports",
    items: [
      { href: "/reports", label: "My Reports", icon: BarChart3, description: "Build and export PDF reports." },
      { href: "/activity", label: "Activity", icon: Activity, description: "Background jobs and data usage.", defaultHidden: true },
    ],
  },
];

const sectionLabel = (id?: string) => NAV_SECTIONS.find((s) => s.id === id)?.label ?? "";

/** "Research · Competitors", "Links", or "" for the top group. */
export function navGroupTitle(g: Pick<NavGroup, "label" | "section">) {
  const s = sectionLabel(g.section);
  return s && g.label ? `${s} · ${g.label}` : s || g.label;
}

export const ALL_TOOLS = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: navGroupTitle(g) })));
export const toolByHref = (href: string) => ALL_TOOLS.find((t) => href === t.href || href.startsWith(`${t.href}/`));

/** Global search's empty state ("Popular tools"), in this order. */
export const POPULAR_TOOLS = ["/optimizer", "/domain-overview", "/keyword-overview", "/keyword-magic-tool", "/site-audit", "/position-tracking", "/backlink-analytics"]
  .map((h) => ALL_TOOLS.find((t) => t.href === h))
  .filter((t): t is (typeof ALL_TOOLS)[number] => !!t);

/** Pages that are searchable but deliberately not in the sidebar (the topbar bell and the footer cover them). */
export const SEARCH_ONLY: { href: string; label: string; icon: LucideIcon; description: string; group: string }[] = [
  { href: "/alerts", label: "Alerts", icon: Bell, description: "Ranking, audit and mention alerts and alert rules.", group: "Account" },
  { href: "/settings", label: "Settings", icon: Settings, description: "Account, API connections, integrations and team.", group: "Account" },
  { href: "/optimizer/crawler", label: "Live crawler", icon: Bug, description: "Watch a spider crawl your website live and flag every SEO issue it finds.", group: "Optimize" },
];

export { FileSearch };
