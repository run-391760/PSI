import {
  BarChart3,
  BellRing,
  BookOpen,
  Bot,
  CalendarDays,
  ClipboardCheck,
  Code2,
  Columns3,
  Contact,
  Ear,
  FileBarChart,
  FlaskConical,
  Images,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  ListFilter,
  ListOrdered,
  Bookmark,
  ListChecks,
  MessagesSquare,
  Search,
  PenSquare,
  MessageSquareHeart,
  MonitorPlay,
  PlugZap,
  Radar,
  Send,
  ShieldCheck,
  Siren,
  Star,
  Tags,
  Upload,
  UserCog,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { NavGroup } from "./nav";

/**
 * Navigation of the CX (customer experience) workspace under /cx: a short, task-oriented sidebar.
 * Administration lives on the Settings hub (/cx/settings, sidebar footer), not in the sidebar.
 * `defaultHidden` items are reachable via search and the Settings hub, and users can show them with
 * "Customize menu". Commented entries are pages other packages are building: enable them (keep the
 * groups at about 5 visible items) once their page.tsx exists.
 */
export const CX_NAV: NavGroup[] = [
  { id: "cx-home", label: "", items: [{ href: "/cx", label: "Overview", icon: LayoutDashboard, description: "What needs attention right now." }] },
  {
    id: "cx-inbox",
    label: "Inbox",
    items: [
      { href: "/cx/inbox", label: "Tickets", icon: Inbox, description: "Omnichannel conversations as tickets with SLAs." },
      { href: "/cx/inbox/queued", label: "Queued", icon: ListOrdered, description: "Tickets waiting for assignment." },
      { href: "/cx/bookmarks", label: "Bookmarks", icon: Bookmark, description: "Messages you saved for later." },
      { href: "/cx/tasks", label: "Tasks", icon: ListChecks, description: "My tasks and all tasks." },
      { href: "/cx/messages", label: "All messages", icon: MessagesSquare, description: "Every inbound and outbound message across tickets.", defaultHidden: true },
      { href: "/cx/search", label: "Quick search", icon: Search, description: "Search tickets, messages, contacts, mentions and tasks.", defaultHidden: true },
      { href: "/cx/contacts", label: "Contacts", icon: Contact, description: "Unified customer profiles and history." },
    ],
  },
  {
    id: "cx-listen",
    label: "Listen",
    items: [
      { href: "/cx/listening", label: "Mentions", icon: Ear, description: "Every mention of your brand across sources." },
      { href: "/cx/listening/dashboards", label: "Listening dashboards", icon: BarChart3, description: "Buzz, sentiment, share of voice, sources, authors." },
      { href: "/cx/listening/reviews", label: "Reviews", icon: Star, description: "Rating trend, star distribution and low-rating reviews." },
      { href: "/cx/crisis", label: "Crisis", icon: Siren, description: "Spike detection, crisis rooms and escalations." },
      { href: "/cx/command", label: "Command centre", icon: MonitorPlay, description: "Full-screen live wall of mentions and KPIs." },
      { href: "/cx/command/streams", label: "Streams", icon: Columns3, description: "Boards of filtered live stream columns.", defaultHidden: true },
      { href: "/cx/listening/ugc", label: "UGC board", icon: Images, description: "User-generated media with consent tracking.", defaultHidden: true },
      { href: "/cx/listening/topics", label: "Topics & competitors", icon: ListFilter, description: "Keywords, exclusions, sources and competitors to track.", defaultHidden: true },
      { href: "/cx/mentions-tracker", label: "Mentions tracker", icon: Radar, description: "Track specific posts, profiles and keywords over time.", defaultHidden: true },
    ],
  },
  {
    id: "cx-publish",
    label: "Publish",
    items: [
      { href: "/cx/compose", label: "Compose", icon: PenSquare, description: "Write a message or post." },
      { href: "/cx/publishing", label: "Publishing", icon: Send, description: "Compose, approve and schedule posts." },
      { href: "/cx/publishing/calendar", label: "Calendar", icon: CalendarDays, description: "Scheduled and published posts by date." },
      { href: "/cx/analytics", label: "Social analytics", icon: BarChart3, description: "Performance of your own channels." },
    ],
  },
  {
    id: "cx-insights",
    label: "Insights",
    items: [
      { href: "/cx/dashboards", label: "Dashboards", icon: LayoutGrid, description: "Custom BI dashboards across all CX data." },
      { href: "/cx/reports", label: "Reports", icon: FileBarChart, description: "Ticket, TAT, SLA and agent reports; download centre." },
      { href: "/cx/surveys", label: "Surveys", icon: MessageSquareHeart, description: "CSAT and NPS surveys and results." },
      { href: "/cx/quality", label: "Quality", icon: ClipboardCheck, description: "Score agent conversations and coach." },
      { href: "/cx/knowledge", label: "Knowledge base", icon: BookOpen, description: "Articles for agents and AI answers.", defaultHidden: true },
      { href: "/cx/ask", label: "Ask AI", icon: Bot, description: "Questions about your CX metrics in plain language.", defaultHidden: true },
      { href: "/cx/ab-testing", label: "A/B testing", icon: FlaskConical, description: "Compare post or reply variants and pick the winner.", defaultHidden: true },
    ],
  },
];

export type SettingsItem = { href: string; label: string; icon: LucideIcon; description: string; /** Page not built yet: hidden on the hub until wired. */ pending?: boolean };
export type SettingsSection = { id: string; label: string; items: SettingsItem[] };

/** Cards on the CX Settings hub (/cx/settings): every admin page, grouped. Brand-scoped links get ?brand=. */
export const CX_SETTINGS: SettingsSection[] = [
  {
    id: "channels",
    label: "Channels & routing",
    items: [
      { href: "/cx/settings/channels", label: "Channels", icon: PlugZap, description: "Connect email, chat, social and review channels." },
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
      { href: "/cx/settings/profile-groups", label: "Profile groups", icon: Users, description: "Group social profiles for routing and reports." },
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
      { href: "/cx/listening/topics", label: "Topics & competitors", icon: ListFilter, description: "Keywords, exclusions, sources and competitors to track." },
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

/** Everything searchable in the CX workspace (sidebar items incl. hidden ones + live settings pages). */
export const CX_SEARCH: { href: string; label: string; description: string; group: string }[] = [
  ...CX_NAV.flatMap((g) => g.items.map((i) => ({ href: i.href, label: i.label, description: i.description, group: g.label || "CX" }))),
  { href: "/cx/settings", label: "Settings", description: "All CX settings, display preferences and hidden menu items.", group: "Settings" },
  ...CX_SETTINGS.flatMap((s) => s.items.filter((i) => !i.pending).map((i) => ({ href: i.href, label: i.label, description: i.description, group: "Settings" }))),
].filter((v, i, a) => a.findIndex((x) => x.href === v.href) === i);
