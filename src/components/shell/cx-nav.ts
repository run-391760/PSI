import {
  BarChart3,
  BellRing,
  BookOpen,
  Bookmark,
  Bot,
  CalendarDays,
  ChartNoAxesColumn,
  ChartPie,
  ClipboardCheck,
  Clock,
  Code2,
  Columns3,
  Contact,
  Download,
  Ear,
  FileText,
  FlaskConical,
  Gauge,
  Images,
  LayoutDashboard,
  LayoutGrid,
  Layers,
  Link2,
  ListOrdered,
  MessageSquare,
  MessageSquareHeart,
  MonitorPlay,
  PenSquare,
  PlugZap,
  Radar,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Siren,
  SquareCheckBig,
  Star,
  Tag,
  Tags,
  ToggleRight,
  Upload,
  UserCog,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { NavGroup, NavItem } from "./nav";

/**
 * Navigation of the CX workspace (/cx), laid out like Konnect: four top tabs, a left sidebar per tab,
 * a hamburger menu of secondary modules, and secondary panels (SETTINGS, REPORTS, TOPICS) rendered by
 * <SectionPanel> (./section-panel) next to an icon rail.
 *
 * Item hrefs may carry a query (`/cx/tasks?view=mine`). Active state: the item whose path (or one of
 * its `match` prefixes) is the longest prefix of the current path wins; query parameters in the href
 * must equal the current ones, except that an `isDefault` item also matches when the parameter is absent.
 */

export type CxTab = "monitor" | "analytics" | "publish" | "dashboard";
export type CxNavItem = NavItem & {
  /** Extra path prefixes that highlight this item (e.g. the One Ticket View highlights Tickets). */
  match?: string[];
  /** Matches when the href's query parameters are absent from the URL (the page's default view). */
  isDefault?: boolean;
  /** Only the exact path matches (not sub-pages), e.g. the /cx overview. */
  exact?: boolean;
};
export type CxNavGroup = Omit<NavGroup, "items"> & { tab: CxTab; items: CxNavItem[] };

export const CX_TABS: { id: CxTab; label: string; href: string }[] = [
  { id: "monitor", label: "Monitor", href: "/cx/inbox" },
  { id: "analytics", label: "Social Analytics", href: "/cx/analytics" },
  { id: "publish", label: "Publish", href: "/cx/publishing" },
  { id: "dashboard", label: "Dashboard", href: "/cx/dashboards" },
];

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Spec §1 tab rule: everything is MONITOR except /cx/analytics, /cx/publishing and /cx/dashboards. */
export function cxTabFor(pathname: string): CxTab {
  if (under(pathname, "/cx/analytics")) return "analytics";
  if (under(pathname, "/cx/publishing")) return "publish";
  if (under(pathname, "/cx/dashboards")) return "dashboard";
  return "monitor";
}

export const isCxPath = (pathname: string) => under(pathname, "/cx");

/** All sidebar groups of every tab. The customize menu, search and the settings hub use this list. */
export const CX_NAV: CxNavGroup[] = [
  // ---------------------------------------------------------------- MONITOR (matches Konnect)
  {
    tab: "monitor",
    id: "monitor-tickets",
    label: "Omni-Channel Tickets",
    items: [
      { href: "/cx/inbox", label: "Tickets", icon: Tag, description: "Omnichannel conversations as tickets with SLAs.", match: ["/cx/ticket"] },
      { href: "/cx/inbox/queued", label: "Queued Tickets", icon: Clock, description: "Tickets waiting in the assignment queue." },
    ],
  },
  {
    tab: "monitor",
    id: "monitor-messages",
    label: "Messages",
    items: [
      { href: "/cx/messages", label: "All Messages", icon: MessageSquare, description: "Every inbound item: ticket messages and listening mentions." },
      { href: "/cx/bookmarks", label: "Bookmarks", icon: Bookmark, description: "Messages you saved for later." },
    ],
  },
  {
    tab: "monitor",
    id: "monitor-setup",
    label: "Setup",
    items: [
      { href: "/cx/settings", label: "Settings", icon: Settings, description: "Omni-channel setup, topics, users, clusters, apps and admin." },
      { href: "/cx/listening/topics", label: "Topics", icon: Layers, description: "Listening topics: keywords, exclusions, sources." },
      { href: "/cx/ab-testing", label: "A/B Testing", icon: ToggleRight, description: "Compare post or reply variants and pick the winner." },
      { href: "/cx/search", label: "Quick Search", icon: Search, description: "Search tickets, messages, contacts, mentions and tasks." },
    ],
  },
  {
    tab: "monitor",
    id: "monitor-reports",
    label: "Reports",
    items: [
      { href: "/cx/reports", label: "Reports", icon: ChartPie, description: "Share of voice, sentiment, ticketing, CSAT and more." },
      { href: "/cx/reports/download", label: "Download", icon: Download, description: "Download centre for report exports." },
      { href: "/cx/reports/one-click", label: "One-Click Report", icon: FileText, description: "A complete report for a period in one click." },
      { href: "/cx/reports/custom", label: "Custom Report", icon: ChartNoAxesColumn, description: "Build your own report from widgets." },
    ],
  },
  {
    tab: "monitor",
    id: "monitor-tasks",
    label: "Tasks",
    items: [
      { href: "/cx/tasks?view=mine", label: "My Tasks", icon: SquareCheckBig, description: "Tasks assigned to you.", isDefault: true },
      { href: "/cx/tasks?view=all", label: "All Tasks", icon: CalendarDays, description: "Every task in this brand." },
    ],
  },
  {
    // Hamburger modules: not in the sidebar by default; "Customize menu" can show them here.
    tab: "monitor",
    id: "monitor-more",
    label: "More",
    items: [
      { href: "/cx", label: "CX overview", icon: LayoutDashboard, description: "What needs attention right now.", defaultHidden: true, exact: true },
      { href: "/cx/listening", label: "Mentions", icon: Ear, description: "Every mention of your brand across sources.", defaultHidden: true },
      { href: "/cx/listening/dashboards", label: "Listening dashboards", icon: BarChart3, description: "Buzz, sentiment, share of voice, sources, authors.", defaultHidden: true },
      { href: "/cx/listening/reviews", label: "Reviews", icon: Star, description: "Rating trend, star distribution and low-rating reviews.", defaultHidden: true },
      { href: "/cx/listening/ugc", label: "UGC board", icon: Images, description: "User-generated media with consent tracking.", defaultHidden: true },
      { href: "/cx/crisis", label: "Crisis", icon: Siren, description: "Spike detection, crisis rooms and escalations.", defaultHidden: true },
      { href: "/cx/command/streams", label: "Streams", icon: Columns3, description: "Boards of filtered live stream columns.", defaultHidden: true },
      { href: "/cx/command", label: "Command Center", icon: MonitorPlay, description: "Full-screen live wall of mentions and KPIs.", defaultHidden: true },
      { href: "/cx/mentions-tracker", label: "Mentions Tracker", icon: Radar, description: "Track specific posts, profiles and keywords over time.", defaultHidden: true },
      { href: "/cx/contacts", label: "Contacts", icon: Contact, description: "Unified customer profiles and history.", defaultHidden: true },
      { href: "/cx/surveys", label: "Surveys", icon: MessageSquareHeart, description: "CSAT and NPS surveys and results.", defaultHidden: true },
      { href: "/cx/quality", label: "Quality", icon: ClipboardCheck, description: "Score agent conversations and coach.", defaultHidden: true },
      { href: "/cx/knowledge", label: "Knowledge base", icon: BookOpen, description: "Articles for agents and AI answers.", defaultHidden: true },
      { href: "/cx/ask", label: "Ask AI", icon: Bot, description: "Questions about your CX metrics in plain language.", defaultHidden: true },
    ],
  },
  // ---------------------------------------------------------------- SOCIAL ANALYTICS
  {
    tab: "analytics",
    id: "analytics-overview",
    label: "Social Analytics",
    items: [{ href: "/cx/analytics", label: "Overview", icon: Gauge, description: "Performance of your own channels, best time to post and link clicks.", isDefault: true }],
  },
  {
    tab: "analytics",
    id: "analytics-period",
    label: "Period",
    items: [
      { href: "/cx/analytics?days=7", label: "Last 7 days", icon: CalendarDays, description: "Social analytics for the last 7 days." },
      { href: "/cx/analytics?days=30", label: "Last 30 days", icon: CalendarDays, description: "Social analytics for the last 30 days." },
      { href: "/cx/analytics?days=90", label: "Last 90 days", icon: CalendarDays, description: "Social analytics for the last 90 days." },
    ],
  },
  // ---------------------------------------------------------------- PUBLISH
  {
    tab: "publish",
    id: "publish-posts",
    label: "Publish",
    items: [
      { href: "/cx/publishing", label: "Scheduled Posts", icon: Send, description: "Compose, approve and schedule posts.", isDefault: true },
      { href: "/cx/publishing/calendar", label: "Calendar", icon: CalendarDays, description: "Scheduled and published posts by date." },
      { href: "/cx/publishing/assets", label: "Assets", icon: Images, description: "Media library for posts." },
      { href: "/cx/ab-testing", label: "A/B Testing", icon: FlaskConical, description: "Compare post variants and pick the winner." },
    ],
  },
  {
    tab: "publish",
    id: "publish-more",
    label: "Manage",
    items: [
      { href: "/cx/publishing?tab=approvals", label: "Approvals", icon: ClipboardCheck, description: "Posts waiting for approval." },
      { href: "/cx/publishing?tab=links", label: "Short links", icon: Link2, description: "Tracked short links and their clicks." },
      { href: "/cx/publishing?tab=settings", label: "Channels & roles", icon: Settings, description: "Publishing channels and approval roles." },
      { href: "/cx/compose", label: "Compose Message", icon: PenSquare, description: "Write a message or post.", defaultHidden: true },
    ],
  },
  // ---------------------------------------------------------------- DASHBOARD (saved dashboards are appended at runtime)
  {
    tab: "dashboard",
    id: "dashboard-main",
    label: "Dashboards",
    items: [{ href: "/cx/dashboards", label: "All dashboards", icon: LayoutGrid, description: "Custom BI dashboards across all CX data." }],
  },
];

export const cxTabGroups = (tab: CxTab) => CX_NAV.filter((g) => g.tab === tab);

/** Hamburger slide-in menu (spec §1): Konnect's own modules, our extra modules grouped, overview. */
export type CxMenuSection = { id: string; label: string; items: { href: string; label: string; icon: LucideIcon; exact?: boolean }[] };
export const CX_MENU: CxMenuSection[] = [
  {
    id: "konnect",
    label: "",
    items: [
      { href: "/cx/settings/alerts", label: "Configure Alerts", icon: BellRing },
      { href: "/cx/compose", label: "Compose Message", icon: PenSquare },
      { href: "/cx/profile", label: "My Profile", icon: UserCog },
      { href: "/cx/plan", label: "My Plan", icon: Gauge },
      { href: "/cx/mentions-tracker", label: "Mentions Tracker", icon: Radar },
      { href: "/cx/command", label: "Command Center", icon: MonitorPlay },
    ],
  },
  {
    id: "listening",
    label: "Listening",
    items: [
      { href: "/cx/listening", label: "Mentions", icon: Ear },
      { href: "/cx/listening/dashboards", label: "Listening dashboards", icon: BarChart3 },
      { href: "/cx/listening/reviews", label: "Reviews", icon: Star },
      { href: "/cx/listening/ugc", label: "UGC board", icon: Images },
      { href: "/cx/crisis", label: "Crisis", icon: Siren },
      { href: "/cx/command/streams", label: "Streams", icon: Columns3 },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    items: [
      { href: "/cx/contacts", label: "Contacts", icon: Contact },
      { href: "/cx/surveys", label: "Surveys", icon: MessageSquareHeart },
      { href: "/cx/quality", label: "Quality", icon: ClipboardCheck },
      { href: "/cx/knowledge", label: "Knowledge base", icon: BookOpen },
      { href: "/cx/ask", label: "Ask AI", icon: Bot },
    ],
  },
  { id: "overview", label: "", items: [{ href: "/cx", label: "CX overview", icon: LayoutDashboard, exact: true }] },
];

// ------------------------------------------------------------------ secondary panels

/** Data for <SectionPanel> (serializable, so server layouts can pass it to the client panel). */
export type SectionItem = { href: string; label: string; match?: string[]; isDefault?: boolean; exact?: boolean; badge?: string };
export type SectionGroup = { label?: string; items: SectionItem[]; /** Start collapsed unless it holds the active item. */ collapsed?: boolean };
export type SectionPanelData = { title: string; groups: SectionGroup[] };

/** SETTINGS panel (spec §3). Existing admin pages highlight "Admin"; profile groups highlight "Clusters". */
export const CX_SETTINGS_PANEL: SectionPanelData = {
  title: "Settings",
  groups: [
    {
      items: [
        { href: "/cx/settings/group", label: "Group Details" },
        { href: "/cx/settings/channels", label: "Omni-Channel Setup" },
        { href: "/cx/settings/topics", label: "Topics" },
        { href: "/cx/settings/users", label: "Users" },
        { href: "/cx/settings/clusters", label: "Clusters", match: ["/cx/settings/profile-groups"] },
        { href: "/cx/settings/social-profiles", label: "More Social Profiles" },
        { href: "/cx/settings/integrations", label: "Integrated Apps" },
        { href: "/cx/settings/apps", label: "All Apps" },
        {
          href: "/cx/settings/admin",
          label: "Admin",
          match: ["/cx/settings/team", "/cx/settings/automation", "/cx/settings/fields", "/cx/settings/queue", "/cx/settings/roles", "/cx/settings/alerts", "/cx/settings/api", "/cx/settings/import"],
        },
      ],
    },
  ],
};

/** REPORTS panel (spec §4). */
export const CX_REPORTS_PANEL: SectionPanelData = {
  title: "Reports",
  groups: [
    {
      label: "Social Listening",
      items: [
        { href: "/cx/reports/share-of-voice", label: "Share of Voice" },
        { href: "/cx/reports/sentiment", label: "Sentiment Analysis" },
        { href: "/cx/reports/media-type", label: "Media Type Analysis" },
        { href: "/cx/reports/twitter", label: "Twitter Report" },
        { href: "/cx/reports/instagram", label: "Instagram Report" },
        { href: "/cx/reports/classifications", label: "Classifications" },
      ],
    },
    {
      label: "Community Engagement",
      items: [
        { href: "/cx/reports/tasks?view=all", label: "All Task Report", isDefault: true },
        { href: "/cx/reports/tasks?view=mine", label: "My Task Report" },
        { href: "/cx/reports/csat", label: "CSAT Report" },
        { href: "/cx/reports/ticketing", label: "Ticketing Report" },
        { href: "/cx/reports/queuing", label: "Queuing Report" },
        { href: "/cx/reports/my-dashboard", label: "My Dashboard" },
      ],
    },
    {
      label: "Calls Analytics",
      collapsed: true,
      items: [
        { href: "/cx/reports/calls?tab=overview", label: "Overview", isDefault: true },
        { href: "/cx/reports/calls?tab=agent-performance", label: "Agent Performance" },
        { href: "/cx/reports/calls?tab=live-status", label: "Agent Live Status" },
        { href: "/cx/reports/calls?tab=agentwise", label: "Agentwise Report" },
      ],
    },
  ],
};

// ------------------------------------------------------------------ active item

type Matchable = { href: string; match?: string[]; isDefault?: boolean; exact?: boolean };

/** Score of an item for the current location; -1 = no match. Longer path prefixes and more matching params win. */
export function matchScore(pathname: string, search: URLSearchParams, item: Matchable): number {
  const [path, qs] = item.href.split("?");
  const prefixes = [path, ...(item.match ?? [])].filter((p, i) => p === pathname || (!(i === 0 && item.exact) && pathname.startsWith(`${p}/`)));
  if (!prefixes.length) return -1;
  let score = Math.max(...prefixes.map((p) => p.length)) * 100;
  for (const [k, v] of new URLSearchParams(qs ?? "")) {
    const cur = search.get(k);
    if (cur === v) score += 10;
    else if (cur == null && item.isDefault) score += 1;
    else return -1;
  }
  return score;
}

/** Href of the best-matching item, or undefined (hamburger-only modules highlight nothing). */
export function pickActive<T extends Matchable>(pathname: string, search: URLSearchParams, items: T[]): string | undefined {
  let best: T | undefined;
  let bestScore = -1;
  for (const it of items) {
    const s = matchScore(pathname, search, it);
    if (s > bestScore) (best = it), (bestScore = s);
  }
  return best?.href;
}

/** Add the kept query params (e.g. ?brand=) of the current URL to an internal href. */
export function keepParams(href: string, search: URLSearchParams, keep: string[] = ["brand"]): string {
  if (!href.startsWith("/cx")) return href;
  const [path, qs] = href.split("?");
  const params = new URLSearchParams(qs ?? "");
  for (const k of keep) {
    const v = search.get(k);
    if (v && !params.has(k)) params.set(k, v);
  }
  const out = params.toString();
  return out ? `${path}?${out}` : path;
}

// ------------------------------------------------------------------ settings hub + search

export type SettingsItem = { href: string; label: string; icon: LucideIcon; description: string; /** Page not built yet: hidden on the hub until wired. */ pending?: boolean };
export type SettingsSection = { id: string; label: string; items: SettingsItem[] };

/** Cards on the CX Settings hub (/cx/settings) and admin pages, grouped. Brand-scoped links get ?brand=. */
export const CX_SETTINGS: SettingsSection[] = [
  {
    id: "channels",
    label: "Channels & routing",
    items: [
      { href: "/cx/settings/channels", label: "Omni-Channel Setup", icon: PlugZap, description: "Connect email, chat, social and review channels." },
      { href: "/cx/settings/queue", label: "Queue & assignment", icon: ListOrdered, description: "Assignment types, agent status and breaks." },
      { href: "/cx/settings/automation", label: "Automation", icon: Workflow, description: "Routing, auto-tagging and canned responses." },
    ],
  },
  {
    id: "team",
    label: "Team & access",
    items: [
      { href: "/cx/settings/team", label: "Team & SLAs", icon: Users, description: "Agents, teams, business hours and SLA policies." },
      { href: "/cx/settings/roles", label: "Roles & permissions", icon: ShieldCheck, description: "Custom roles, permissions and audit log." },
      { href: "/cx/settings/clusters", label: "Clusters", icon: Users, description: "Group profiles and topics for routing, filters and reports." },
      { href: "/cx/profile", label: "My profile", icon: UserCog, description: "Your agent profile, signature and notifications." },
    ],
  },
  {
    id: "data",
    label: "Tickets & data",
    items: [
      { href: "/cx/settings/fields", label: "Fields & classification", icon: Tags, description: "Classification tree, additional info and custom fields." },
      { href: "/cx/settings/import", label: "Data import", icon: Upload, description: "Import tickets and contacts from files.", pending: true },
      { href: "/cx/settings/api", label: "API & webhooks", icon: Code2, description: "REST API tokens and outbound webhooks." },
    ],
  },
  {
    id: "listening",
    label: "Listening",
    items: [
      { href: "/cx/listening/topics", label: "Topics & competitors", icon: Layers, description: "Keywords, exclusions, sources and competitors to track." },
      { href: "/cx/settings/alerts", label: "Alerts", icon: BellRing, description: "Keyword and volume alerts by email, Slack or Telegram." },
    ],
  },
  {
    id: "account",
    label: "Account",
    items: [
      { href: "/cx/plan", label: "Plan & usage", icon: BarChart3, description: "Seats, channels and usage against your plan." },
      { href: "/settings", label: "Account & sign-in", icon: UserCog, description: "Name, password, API keys and integrations." },
    ],
  },
];

const TAB_LABEL: Record<CxTab, string> = { monitor: "Monitor", analytics: "Social analytics", publish: "Publish", dashboard: "Dashboard" };

/** Everything searchable in the CX workspace: sidebar items (incl. hidden), hamburger modules, panels, settings. */
export const CX_SEARCH: { href: string; label: string; description: string; group: string }[] = [
  ...CX_NAV.flatMap((g) => g.items.map((i) => ({ href: i.href, label: i.label, description: i.description, group: g.id === "monitor-more" ? "CX" : `${TAB_LABEL[g.tab]} · ${g.label}` }))),
  ...CX_MENU.flatMap((s) => s.items.map((i) => ({ href: i.href, label: i.label, description: s.label ? `${s.label} module` : "CX module", group: s.label || "CX" }))),
  ...CX_REPORTS_PANEL.groups.flatMap((g) => g.items.map((i) => ({ href: i.href, label: i.label, description: `${g.label} report`, group: "Reports" }))),
  ...CX_SETTINGS_PANEL.groups.flatMap((g) => g.items.map((i) => ({ href: i.href, label: i.label, description: "Settings", group: "Settings" }))),
  ...CX_SETTINGS.flatMap((s) => s.items.filter((i) => !i.pending).map((i) => ({ href: i.href, label: i.label, description: i.description, group: "Settings" }))),
].filter((v, i, a) => a.findIndex((x) => x.href === v.href) === i);
