import { CircleCheck, CircleDashed, ExternalLink, Info, KeyRound, Palette, Plug, ShieldAlert, User, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { dateLabel, money } from "@/lib/format";
import { monthlySpend } from "@/lib/providers/dataforseo";
import { globalBudgetUsd, integrations, maxMonthlyUsd, systemInfo } from "@/lib/reports/platform";
import { credentialStatus } from "@/lib/integrations/registry";
import { AccountSummary } from "@/components/settings/account-summary";
import { ApiKeyMap } from "@/components/settings/api-key-map";
import { BudgetForm, DeleteAccount, PasswordForm, ProfileForm, SignOutOthers, ThemeSelector } from "@/components/settings/account-forms";
import { CopyButton } from "@/components/settings/copy-button";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Bar } from "@/components/ui/progress";
import { TabsNav } from "@/components/ui/tabs";

export const metadata: Metadata = { title: "Settings" };

const TABS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "budget", label: "Budget", icon: Wallet },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "danger", label: "Danger zone", icon: ShieldAlert },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const tab: TabId = TABS.some((t) => t.id === sp.tab) ? (sp.tab as TabId) : "profile";
  const [[info], [sessions], spend, [counts]] = await Promise.all([
    query<{ created_at: string | Date }>("SELECT created_at FROM users WHERE id=$1", [user.id]),
    query<{ count: number }>("SELECT count(*)::int AS count FROM sessions WHERE user_id=$1 AND expires_at>now()", [user.id]),
    monthlySpend(user.id),
    query<{ projects: number; reports: number }>("SELECT (SELECT count(*) FROM projects WHERE owner_id=$1)::int AS projects, (SELECT count(*) FROM reports WHERE owner_id=$1)::int AS reports", [user.id]),
  ]);
  const cap = maxMonthlyUsd();
  const budget = Number(user.monthly_budget_micros) / 1e6;

  return (
    <Page>
      <PageHeader breadcrumbs={[{ label: "Settings" }]} title="Settings" description="Your profile, data providers, spending limits and preferences." />
      <TabsNav
        className="mb-5"
        items={TABS.map((t) => ({
          href: t.id === "profile" ? "/settings" : `/settings?tab=${t.id}`,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </span>
          ),
        }))}
      />

      {tab === "profile" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4">
            <Card>
              <CardHeader title="Profile" description="How you appear in SynapseSEO and on reports you create." />
              <CardBody>
                <ProfileForm name={user.name} email={user.email} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Password" description="You'll need your current password to set a new one." />
              <CardBody>
                <PasswordForm />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Sessions" description="Browsers and devices signed in to your account." />
              <CardBody>
                <SignOutOthers others={Math.max(0, sessions.count - 1)} />
              </CardBody>
            </Card>
          </div>
          <AccountSummary name={user.name} email={user.email} since={info ? dateLabel(info.created_at instanceof Date ? info.created_at : new Date(info.created_at)) : "n/a"} projects={counts.projects} reports={counts.reports} />
        </div>
      )}

      {tab === "integrations" && <Integrations />}

      {tab === "budget" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card>
            <CardHeader title="Monthly API budget" description="Paid provider calls (DataForSEO) stop when your budget for the month is used up." />
            <CardBody>
              <BudgetForm budget={budget} cap={cap} spend={spend} />
            </CardBody>
          </Card>
          <Card className="h-fit">
            <CardHeader title="This month" href="/activity?tab=usage" />
            <CardBody className="space-y-3 text-[13px]">
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[22px] font-semibold text-text">{money(spend)}</span>
                  <span className="text-text-3">of {money(Math.min(budget, cap))}</span>
                </div>
                <Bar value={spend} max={Math.min(budget, cap) || 1} className="mt-2 h-2" color={spend / (Math.min(budget, cap) || 1) > 0.9 ? "var(--critical)" : "var(--brand)"} />
              </div>
              <ul className="space-y-1.5 text-[12.5px] text-text-2">
                <li className="flex justify-between gap-2">
                  <span>Per-user cap (MAX_MONTHLY_API_USD)</span>
                  <span className="font-medium text-text">{money(cap)}</span>
                </li>
                <li className="flex justify-between gap-2">
                  <span>Deployment cap (GLOBAL_API_BUDGET_USD)</span>
                  <span className="font-medium text-text">{money(globalBudgetUsd())}</span>
                </li>
              </ul>
              <p className="text-[12px] text-text-3">Each call reserves its worst-case cost before it runs, so you can never overspend. Responses are cached to avoid paying twice for the same question.</p>
              <Link href="/activity?tab=usage" className="inline-block text-[12.5px] text-link hover:underline">
                View usage details →
              </Link>
            </CardBody>
          </Card>
        </div>
      )}

      {tab === "appearance" && (
        <Card>
          <CardHeader title="Theme" description="Saved in this browser. System follows your operating system's light or dark setting." />
          <CardBody>
            <ThemeSelector />
          </CardBody>
        </Card>
      )}

      {tab === "danger" && (
        <Card className="border-critical/40">
          <CardHeader title="Delete account" description="Permanently remove your account and all of its data." />
          <CardBody className="space-y-4">
            <Callout tone="critical" title="This cannot be undone">
              Deleting your account removes {counts.projects} project{counts.projects === 1 ? "" : "s"}, {counts.reports} report{counts.reports === 1 ? "" : "s"}, and every audit, tracked keyword, alert, job and usage record that belongs to them.
            </Callout>
            <DeleteAccount email={user.email} />
          </CardBody>
        </Card>
      )}
    </Page>
  );
}

function Integrations() {
  const list = integrations();
  const sys = systemInfo();
  const missing = list.flatMap((i) => i.envVars.filter((v) => !v.set && (v.required || i.status === "not-configured")).map((v) => ({ ...v, provider: i.name })));
  const snippet = [
    "# .env.local (project root) — restart the server after editing",
    ...list.flatMap((i) => [`# ${i.name}`, ...i.envVars.map((v) => `${v.name}=${v.example.includes("…") || v.example.includes("@") || v.example.startsWith("your") ? "" : v.example}`)]),
  ].join("\n");
  return (
    <div className="space-y-4">
      <Card id="api-keys">
        <CardHeader title="API keys & where they're used" description="Every key the SEO and CX workspaces read, whether it is set, and each feature it powers." />
        <CardBody>
          <ApiKeyMap status={credentialStatus()} workspace="SEO" />
        </CardBody>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          {list.map((i) => {
            const good = i.status === "connected" || i.status === "enabled";
            return (
              <Card key={i.id}>
                <div className="flex flex-wrap items-start gap-3 px-4 py-3.5">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${good ? "bg-good-soft text-good-ink" : "bg-surface-3 text-text-3"}`}>
                    <Plug className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[14px] font-semibold text-text">{i.name}</h2>
                      <Badge tone={good ? "good" : i.status === "disabled" ? "neutral" : "warning"}>
                        {good ? <CircleCheck className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
                        {i.statusLabel}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-[12.5px] text-text-2">{i.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {i.powers.map((p) => (
                        <span key={p} className="rounded bg-surface-3 px-1.5 py-0.5 text-[11.5px] text-text-2">
                          {p}
                        </span>
                      ))}
                    </div>
                    <ul className="mt-3 space-y-1">
                      {i.envVars.map((v) => (
                        <li key={v.name} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                          <code className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11.5px] text-text">{v.name}</code>
                          {v.set ? <span className="text-good-ink">set</span> : <span className="text-text-3">{v.name.startsWith("ENABLE_") ? "not set · defaults to true" : "not set"}</span>}
                          <span className="text-text-3">· {v.required ? "required" : "optional"}</span>
                        </li>
                      ))}
                    </ul>
                    {i.note && <p className="mt-2 text-[12px] text-text-3">{i.note}</p>}
                  </div>
                  {i.docs && (
                    <a href={i.docs} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12.5px] text-link hover:underline">
                      Docs <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="How to connect" description="Secrets never pass through the browser" />
            <CardBody className="space-y-3 text-[12.5px] text-text-2">
              <ol className="list-decimal space-y-1.5 pl-4">
                <li>
                  Add the variables to <code className="rounded bg-surface-3 px-1 font-mono text-[11.5px]">.env.local</code> in the project root.
                </li>
                <li>Restart the SynapseSEO server so it reads the new values.</li>
                <li>Come back here — the status updates automatically.</li>
              </ol>
              {missing.length > 0 && (
                <Callout tone="info" className="text-[12px]">
                  Not set yet: {missing.map((m) => m.name).join(", ")}
                </Callout>
              )}
              <div className="overflow-hidden rounded-md border border-border">
                <div className="flex items-center justify-between border-b border-border bg-surface-2 px-2.5 py-1">
                  <span className="font-mono text-[11px] text-text-3">.env.local</span>
                  <CopyButton text={snippet} />
                </div>
                <pre className="scroll-thin max-h-72 overflow-auto bg-surface-2 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-text-2">{snippet}</pre>
              </div>
              <p className="flex items-start gap-1.5 text-[12px] text-text-3">
                <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Values are read on the server only and are never displayed here.
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="System" />
            <CardBody>
              <dl className="space-y-2 text-[12.5px]">
                {[
                  ["Database", sys.database],
                  ["Background worker", sys.worker],
                  ["Sign-ups", sys.signups],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-text-3">{k}</dt>
                    <dd className="text-right text-text">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 flex items-start gap-1.5 text-[12px] text-text-3">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Free sources are on by default; set their ENABLE_* variable to false to stay fully offline.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
