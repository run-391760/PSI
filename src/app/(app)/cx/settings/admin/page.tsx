import { BarChart3, BellRing, ChevronRight, Code2, ListOrdered, ShieldCheck, Tags, Upload, UserCog, Users, Workflow, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DisplaySettings } from "@/components/shell/display-settings";
import { Page } from "@/components/shell/page";
import { settingsPage, SettingsHeader } from "../_admin/settings-page";

export const metadata: Metadata = { title: "Admin" };

type AdminCard = { href: string; label: string; icon: LucideIcon; description: string; perm?: string };
const SECTIONS: { label: string; items: AdminCard[] }[] = [
  {
    label: "Team & routing",
    items: [
      { href: "/cx/settings/team", label: "Team & SLAs", icon: Users, description: "Agents, teams, business hours, SLA policies, TAT rules and escalations.", perm: "page:settings.team" },
      { href: "/cx/settings/queue", label: "Queue & assignment", icon: ListOrdered, description: "Assignment types, agent statuses and breaks, segments routed to user groups.", perm: "page:settings.queue" },
      { href: "/cx/settings/automation", label: "Automation", icon: Workflow, description: "Routing rules, auto-tagging, canned responses and quick actions.", perm: "page:settings.automation" },
    ],
  },
  {
    label: "Tickets & data",
    items: [
      { href: "/cx/settings/fields", label: "Fields & classification", icon: Tags, description: "Classification tree, additional info and custom fields (CSV import).", perm: "page:settings.fields" },
      { href: "/cx/settings/users", label: "Data import", icon: Upload, description: "CSV imports: users (Users → Upload users) and classifications (Fields).", perm: "page:settings.team" },
      { href: "/cx/settings/api", label: "API & webhooks", icon: Code2, description: "REST API tokens, outbound webhooks and external lookups.", perm: "page:settings.api" },
    ],
  },
  {
    label: "Security & alerts",
    items: [
      { href: "/cx/settings/roles", label: "Roles & audit", icon: ShieldCheck, description: "Custom roles, page and action permissions, PII masking and the audit log.", perm: "page:settings.roles" },
      { href: "/cx/settings/users/ip", label: "IP whitelisting", icon: ShieldCheck, description: "Limit this brand to approved IP addresses.", perm: "page:settings.roles" },
      { href: "/cx/settings/alerts", label: "Alerts", icon: BellRing, description: "Keyword and volume alerts by email, Slack or Telegram.", perm: "page:settings.alerts" },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/cx/plan", label: "Plan & usage", icon: BarChart3, description: "Seats, channels and usage against your plan." },
      { href: "/cx/profile", label: "My profile", icon: UserCog, description: "Your agent profile, signature and notifications." },
      { href: "/settings", label: "Account & sign-in", icon: UserCog, description: "Name, password, API keys and integrations." },
    ],
  },
];

/** Admin: card hub to every existing admin page, plus the viewer's display preferences and hidden menu items. */
export default async function AdminHubPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { el, ctx } = await settingsPage(await searchParams, { title: "Admin", path: "/cx/settings/admin", perm: null });
  if (!ctx) return el;
  const link = (h: string) => (h.startsWith("/cx") ? `${h}?brand=${ctx.brand.id}` : h);
  return (
    <Page>
      <SettingsHeader title="Admin" ctx={ctx} description="Every administration page for this brand, plus how the workspace looks for you." />
      <div className="mb-6 grid grid-cols-1 gap-x-4 gap-y-5 md:grid-cols-2 xl:grid-cols-4">
        {SECTIONS.map((s) => (
          <section key={s.label} className="min-w-0">
            <h2 className="mb-2 text-[11.5px] font-semibold tracking-wide text-text-3 uppercase">{s.label}</h2>
            <ul className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
              {s.items.map((i) => {
                const locked = !!i.perm && !ctx.perms.includes(i.perm);
                return (
                  <li key={i.href + i.label} className="border-b border-border last:border-0">
                    <Link href={link(i.href)} className="group flex items-center gap-3 px-3.5 py-2.5 hover:bg-surface-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-3 text-text-2"><i.icon className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-text">{i.label}{locked && <span className="ml-1.5 text-[11px] font-normal text-text-3">(no access)</span>}</span>
                        <span className="line-clamp-2 text-[12px] text-text-3">{i.description}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-text-3 group-hover:text-text" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <h2 className="mb-2 text-[11.5px] font-semibold tracking-wide text-text-3 uppercase">Your workspace</h2>
      <DisplaySettings brand={ctx.brand.id} />
    </Page>
  );
}
