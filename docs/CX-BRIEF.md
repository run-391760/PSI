# CX workspace brief

A second workspace inside SynapseSEO, under `/cx`, switched from the header (SEO | CX). It provides the
feature set of an omnichannel customer-experience platform (in the style of Konnect Insights — build
equivalent functionality with our own branding; never copy their name, logo or UI assets):
social listening, crisis management, omnichannel inbox/ticketing with SLAs, social CRM, publishing,
social analytics, BI dashboards, surveys (CSAT/NPS), quality assessment, team/SLA/automation settings.

Read `docs/BUILD-BRIEF.md` (ownership, testing, forbidden commands — no npm install/build/dev/git, never
open the DB from scripts) and `docs/REAL-DATA.md` (no synthetic numbers; NeedsData-style states) first.

## Shared foundation (read-only for you)

- A **brand** = one of the user's projects. `cxContext(user.id, searchParams)` (`@/lib/cx/context`) →
  `{ projects, brand, switcher }`; `<BrandSwitcher brands={switcher} current={brand.id} />`
  (`@/components/cx/brand-switcher`). Links inside CX must keep `?brand=`.
  No brand → show an empty state with `NewProjectButton` (redirectTo `/cx?brand={id}`).
- Core tables (`src/lib/schema/cx.ts`): `cx_channels` (connected channels; secrets go in `secret_enc`
  via `encryptSecret`/`decryptSecret` from `@/lib/secrets`), `cx_contacts`, `cx_tickets`, `cx_messages`,
  `cx_topics`, `cx_mentions`. Put module-only tables in your `src/lib/schema/cx-<module>.ts`.
  Ticket numbers: `SELECT COALESCE(MAX(number),0)+1 FROM cx_tickets WHERE project_id=$1` inside a transaction.
- Channel catalogue `CHANNELS`, `channelInfo` (`@/lib/cx/channels`, client-safe) with API, cost (free /
  free-approval / paid), env vars and setup text; `channelAvailable(kind)` (`@/lib/cx/providers`, server).
- Text understanding `@/lib/cx/ai`: `analyzeText(text)` → sentiment/score (free lexicon), intent
  (rule-based), language (script-based). `complete()` / `suggestReply()` use Claude or OpenAI when a key
  is configured and return `null` otherwise — then hide AI features behind a small "Connect an AI key" note.
- Jobs: `enqueue`, `setSchedule`, `notify` (`@/lib/jobs/queue`); handlers in your `src/lib/cx/<module>/jobs.ts`,
  registered by the orchestrator (tell me the file). Job kinds `cx.<module>.<action>`.
- UI kit, charts, formatting: same as the SEO workspace (see BUILD-BRIEF). Pages use `Page`/`PageHeader`,
  breadcrumbs start with `{ label: "CX" }`.

Note: PGlite returns `timestamptz` columns as `Date` objects — convert with `new Date(v).toISOString()`.
Inbox deep links: `/cx/inbox?brand=<id>&ticket=<ticketId>`.

## Data rules

Real data only. Channels whose API is not configured show a connect card (use the catalogue's `api`,
`costNote`, `env`, `setup`). Built-in channels (email via IMAP/SMTP, live chat widget, web form) and all
user-owned data (tickets, contacts, notes, surveys, QA scores, drafts, dashboards) are real and fully
functional. Metrics are computed from stored real records only; "n/a" when unknown.

## Testing

The dev server (http://127.0.0.1:3200) has no third-party API keys. Exercise flows with the free and
built-in channels (Google News, Hacker News, Mastodon, App Store RSS, live chat, web form) and with data
you create through the UI. Put API-row → record mapping in pure functions with fixture tests
(`tests/cx-<module>.test.ts`). Screenshots: `node scripts/shot.mjs <dir> <paths>` with your own EMAIL.
Light/dark, 390px, zero console errors, `tsc` clean for your files.

## Navigation and declutter (WP-A)

The CX sidebar (`src/components/shell/cx-nav.ts`) is short and task-oriented: Overview, Inbox, Listen,
Publish, Insights (about 5 visible items per group). Administration is NOT in the sidebar: every admin
page is a card on the Settings hub `/cx/settings` (sidebar footer "Settings"), defined in `CX_SETTINGS`.
New admin pages go into `CX_SETTINGS`; new day-to-day pages go into a `CX_NAV` group, with
`defaultHidden: true` for secondary pages (they stay in search, on the hub's "Not in your menu" list and
can be shown via "Customize menu"). Ask the orchestrator before adding nav entries.

Per-user display preferences (table `cx_ui_prefs`, one jsonb doc, loaded server-side in `AppShell` so
there is no flash) apply to both workspaces:

- **Focus mode** (topbar button, Display menu, Ctrl/⌘ + `\`, Esc exits; a "Focus mode ×" pill shows
  while on): sidebar becomes an icon rail, `<Page>` goes full width and every element with the
  `data-focus-hide` attribute is hidden. **Mark secondary KPI strips, right-hand side panels and
  secondary navigation in your pages with `data-focus-hide`** (wrap in a `<div data-focus-hide>` if needed).
  Primary content must never carry it.
- **Density** comfortable/compact: `data-density="compact"` on the shell shrinks Tailwind's `--spacing`
  inside `<main>` (all `p-*`, `gap-*`, `h-*` utilities) and table/heading text. Use spacing utilities
  rather than arbitrary px values so your page follows it. CSS: `src/components/shell/declutter.css`.
- **Customize menu**: pin, hide and reorder CX sidebar items; "Reset to default".
- **Hideable panels**: let users collapse or hide optional widgets.

```tsx
import { Hideable, ShowHidden } from "@/components/shell/hideable";

<PageHeader ... actions={<ShowHidden scope="cx-reports" />} />   // "Show hidden (n)" restore menu
<Hideable id="cx-reports.agent-table" label="Agent table">       // id = "<scope>.<name>", stable
  <Card>...</Card>
</Hideable>
<Hideable id="cx-reports.trends" label="Trends" defaultState="collapsed" refreshOnExpand>
  {open ? <Charts /> : null}
</Hideable>
```

Hover (or tap on touch screens) shows a small collapse/hide control on the panel's top edge. Collapsed
panels render as a one-line bar; hidden ones disappear and are listed by `<ShowHidden scope>`. To skip
expensive queries for panels that aren't open, read the state on the server:
`panelState((await getUiPrefs(user.id)).panels, id, defaultState) === "open"` (`@/lib/cx/ui/prefs`,
`@/lib/cx/ui/prefs-logic`) and pass `refreshOnExpand` so expanding re-renders with data. Examples:
`src/app/(app)/cx/page.tsx` (overview sections) and `src/app/(app)/cx/dashboards/page.tsx` (cards).
Client code can read/update preferences with `useUiPrefs()` from `@/components/shell/ui-prefs`.
