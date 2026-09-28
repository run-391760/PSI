import {
  AlarmClock,
  BarChart3,
  Bot,
  CalendarDays,
  ClipboardCheck,
  Contact,
  Ear,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  ListFilter,
  MessageSquareHeart,
  PlugZap,
  Send,
  Siren,
  Users,
  Workflow,
} from "lucide-react";
import type { NavGroup } from "./nav";

/** Navigation of the CX (customer experience) workspace under /cx. */
export const CX_NAV: NavGroup[] = [
  { id: "cx-home", label: "", items: [{ href: "/cx", label: "Overview", icon: LayoutDashboard, description: "Customer experience at a glance." }] },
  {
    id: "cx-listen",
    label: "Listen",
    items: [
      { href: "/cx/listening", label: "Mentions", icon: Ear, description: "Every mention of your brand across sources." },
      { href: "/cx/listening/dashboards", label: "Listening dashboards", icon: BarChart3, description: "Buzz, sentiment, share of voice, sources, authors." },
      { href: "/cx/listening/topics", label: "Topics & competitors", icon: ListFilter, description: "Keywords, exclusions, sources and competitors to track." },
      { href: "/cx/crisis", label: "Crisis management", icon: Siren, description: "Spike detection, crisis rooms and escalations." },
    ],
  },
  {
    id: "cx-engage",
    label: "Engage",
    items: [
      { href: "/cx/inbox", label: "Inbox & tickets", icon: Inbox, description: "Omnichannel conversations as tickets with SLAs." },
      { href: "/cx/contacts", label: "Contacts (CRM)", icon: Contact, description: "Unified customer profiles and history." },
    ],
  },
  {
    id: "cx-publish",
    label: "Publish",
    items: [
      { href: "/cx/publishing", label: "Publishing", icon: Send, description: "Compose, approve and schedule posts." },
      { href: "/cx/publishing/calendar", label: "Content calendar", icon: CalendarDays, description: "Scheduled and published posts by date." },
      { href: "/cx/analytics", label: "Social analytics", icon: BarChart3, description: "Performance of your own channels." },
    ],
  },
  {
    id: "cx-insights",
    label: "Insights",
    items: [
      { href: "/cx/dashboards", label: "Dashboards", icon: LayoutGrid, description: "Custom BI dashboards across all CX data." },
      { href: "/cx/surveys", label: "Surveys (CSAT/NPS)", icon: MessageSquareHeart, description: "Feedback surveys and results." },
      { href: "/cx/quality", label: "Quality assessment", icon: ClipboardCheck, description: "Score agent conversations and coach." },
    ],
  },
  {
    id: "cx-admin",
    label: "Administration",
    items: [
      { href: "/cx/settings/channels", label: "Channels", icon: PlugZap, description: "Connect email, chat, social and review channels." },
      { href: "/cx/settings/team", label: "Team & SLAs", icon: Users, description: "Agents, teams, business hours and SLA policies." },
      { href: "/cx/settings/automation", label: "Automation", icon: Workflow, description: "Routing, auto-tagging and canned responses." },
    ],
  },
];
export { AlarmClock, Bot };
