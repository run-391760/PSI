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

## Navigation and shell (Konnect layout, WP-K1)

Contract: `docs/KONNECT-UI-SPEC.md` §1. Data lives in `src/components/shell/cx-nav.ts`:

- **Top tabs** `CX_TABS` (MONITOR → `/cx/inbox`, SOCIAL ANALYTICS → `/cx/analytics`, PUBLISH →
  `/cx/publishing`, DASHBOARD → `/cx/dashboards`); `cxTabFor(pathname)` applies the route rule (MONITOR
  unless the path starts with `/cx/analytics`, `/cx/publishing` or `/cx/dashboards`).
- **Sidebars** `CX_NAV`: groups tagged with their `tab`. MONITOR matches Konnect (Omni-Channel Tickets,
  Messages, Setup, Reports, Tasks) plus a "More" group of `defaultHidden` hamburger modules that users can
  show via "Customize menu". Items: `{ href, label, icon, description, match?, isDefault?, exact?, defaultHidden? }`.
  Hrefs may carry a query (`/cx/tasks?view=mine`); the active item is the longest path prefix (or `match`
  prefix) whose query params equal the URL's (`isDefault` items also match when the param is absent).
  `pickActive(pathname, searchParams, items)` and `keepParams(href, searchParams, keep=["brand"])` are exported.
  The DASHBOARD sidebar appends the brand's saved dashboards at runtime.
- **Hamburger menu** `CX_MENU`: Configure Alerts, Compose Message, My Profile, My Plan, Mentions Tracker,
  Command Center; Listening and Customers modules; CX overview; Settings, Customize menu, Logout. On phones
  it also holds the current tab's sidebar (the sidebar itself is desktop-only).
- Ask the orchestrator before adding nav entries. New admin pages go into `CX_SETTINGS` (hub cards) and,
  if they belong in the SETTINGS panel, into `CX_SETTINGS_PANEL` (or its Admin item's `match`).

### Secondary panels: `<SectionPanel>` + `<SectionLayout>`

On Settings, Topics and Reports the sidebar collapses to an icon rail (tooltips on hover) and a second
panel shows the section's own navigation. The rail is CSS-driven (`:has([data-section-panel])`), so any
page or layout that renders a `SectionPanel` gets it with no flash. Panel data must be serializable
(no icon components), so server layouts can pass it straight through.

```tsx
// src/app/(app)/cx/settings/layout.tsx   (WP-K3)  — same for reports with CX_REPORTS_PANEL (WP-K4)
import { CX_SETTINGS_PANEL } from "@/components/shell/cx-nav";
import { SectionLayout, SectionPanel } from "@/components/shell/section-panel";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SectionLayout panel={<SectionPanel {...CX_SETTINGS_PANEL} />}>{children}</SectionLayout>;
}

// Reports: header icons + carry the scope/date between reports
<SectionPanel {...CX_REPORTS_PANEL} keep={["brand", "scope", "from", "to"]}
  icons={<><button aria-label="Duplicate"><Copy className="h-4 w-4" /></button>…</>} />

// Topics (dynamic list): build the groups on the server
<SectionPanel title="Topics" icons={…} groups={[{ items: topics.map((t) => ({ href: `/cx/listening/topics?topic=${t.id}`, label: t.name })) }]} />
```

`SectionPanel` props: `title`, `groups: { label?, items: { href, label, match?, isDefault?, exact?, badge? }[], collapsed? }[]`,
`icons?: ReactNode`, `keep?: string[]` (query params carried into links, default `["brand"]`), `children?`
(extra content under the groups), `className?`. Groups with `collapsed: true` start folded unless they hold
the active item. On phones the panel is a collapsible block above the content; in focus mode it is hidden.
`SectionLayout({ panel, children })` puts the panel left (top on phones) and the content right; pages
inside keep using `<Page>`.

### Topic / Profile scope: `<ScopePicker>` + `@/lib/cx/ops/scope`

The shared Konnect "Topic / Profile" filter (ticket streams, reports). Value type and pure helpers:
`@/lib/cx/ops/scope-model` (client-safe); server loaders: `@/lib/cx/ops/scope` (re-exports the model).

```ts
type ScopeValue = { clusters: string[]; topics: string[]; profiles: string[] };
// clusters = cx_ops_profile_groups ids · topics = cx_topics ids
// profiles = cx_channels ids, and listening sources as "src_<kind>" (e.g. "src_news")
type ScopeOptions = { clusters: ClusterOption[]; topics: TopicOption[]; profiles: ProfileOption[] };
// ClusterOption { id, name, channelIds, sources, topicIds, isDefault }   (topicIds read from a
//   `topic_ids` jsonb column on cx_ops_profile_groups when it exists)
// TopicOption { id, name, kind, active } · ProfileOption { id, name, network, type: "channel"|"source", status? }
type ResolvedScope = { all: boolean; channelIds: string[]; topicIds: string[]; sourceKinds: string[] };
```

An **empty scope means everything** (no filter); otherwise the union of the ticked clusters (expanded),
topics and profiles. URL: `?scope=c.<id>.<id>*t.<id>*p.<id>.src_news` (`encodeScope`, `decodeScope`,
`scopeFromParams(sp)`, `withScopeParam(params, v)`), omitted when empty.

```tsx
// server page
import { binder, resolveScope, scopeFromParams, scopeOptions, ticketScopeSql } from "@/lib/cx/ops/scope";
const options = await scopeOptions(brand.id);
const r = await resolveScope(brand.id, scopeFromParams(sp), options);
const params: unknown[] = [brand.id];
const rows = await query(`SELECT … FROM cx_tickets t WHERE t.project_id=$1 AND ${ticketScopeSql(r, binder(params), "t")}`, params);
// also messageScopeSql(r, p, "m") for cx_messages and mentionScopeSql(r, p, "mn") for cx_mentions
// ("true" for an empty scope, "false" when it selects nothing that exists)

// client
import { ScopePicker } from "@/components/cx/scope-picker";
<ScopePicker options={options} />                              // SAVE writes ?scope= (drops ?page=)
<ScopePicker options={options} value={v} onChange={setV} sync={false} />   // controlled, URL untouched
```

`ScopePicker` props: `options`, `value?`, `onChange?`, `sync?` (default true), `param?` ("scope"),
`placeholder?`, `align?` ("left" | "right"), `className?`. Nothing applies until SAVE; Esc / outside click
discards. `NetworkIcon({ kind })` (`@/components/cx/network-icon`) draws the network glyph for a channel
or source kind. Fixture tests: `tests/cx-scope.test.ts`.

## Monitor streams and One Ticket View (WP-K2)

Tickets (`/cx/inbox`), Queued Tickets (`/cx/inbox/queued`), All Messages (`/cx/messages`) and Bookmarks
(`/cx/bookmarks`) render Konnect ticket cards (`<StreamCard>`, `src/components/cx/inbox/stream-card.tsx`) next to
the right-hand FILTER panel (`<StreamPanel>`, `filter-panel.tsx`, carries `data-focus-hide`, a drawer below `lg`).
All filter state is in the URL: `scope`, `from`/`to` (yyyy-mm-dd; dd/mm/yyyy accepted), `media` (comma list of
media-type ids), `sort` (`latest` default | `oldest`; tickets also `priority`, `sla`, `updated`), `q`, and the More
Filters `sentiment`, `status` (a CRM status or comma list), `assignee` (`none` = unassigned), `priority`, `tag`,
`lang`, `attach=1`, `cls` (classification id), `direction` (All Messages: `in` default, `out`, `note`, `all`), `kind`.
PROFILE rows set `profile=<channelId>`, `topic=<topicId>` or `channel=<kind>`. Pure helpers (parsing, card
mapping, facets) live in `@/lib/cx/inbox/stream`; server queries in `@/lib/cx/inbox/streams`.

**Media types** (`MEDIA_TYPES`, `mediaTypeOf`, `mentionMediaType`, `mediaLabel`, `mediaNetwork`, `isPublicMedia`,
`profileBadge` in `@/lib/cx/ops/model`; SQL mirrors `MEDIA_SQL` (alias `t`) and `MENTION_MEDIA_SQL` (alias `mn`) in
`@/lib/cx/ops/media`): Konnect's list first (News, Blogs, Other - Web, Twitter Public Tweets, Twitter Mentions,
Facebook Public Posts / Tag Posts / Inbox / Comments, YouTube, Instagram, Instagram Messages / Comments, LinkedIn
Comments, Google Business Reviews, Instagram Tag Posts / Mentions, LinkedIn Mentions), then ours (email, live chat,
web form, …). Tickets created from listening mentions (no channel id) follow the mention source. Reports should
use these for "Media Type Analysis".

**One Ticket View**: `/cx/ticket/<ticketId>?brand=<brandId>` (stable; `ticketHref(brand, id, extra?)` from
`@/lib/cx/inbox/stream`). `&act=compose|child|task` opens that dialog on load. It reuses the inbox
`<Conversation>` (thread, composer with Reply/Comment, Private reply and Note, every action) plus a contact panel,
activity, print and transcript downloads.

**Mention → ticket** (server action, `@/app/(app)/cx/ticket/actions`):

```ts
createTicketFromMentionAction(brand: string, mentionId: string)
  : Promise<ActionResult<{ id: string; number: number; existing: boolean }>>
// idempotent: a mention that already has a ticket returns it (existing: true). Then router.push(ticketHref(brand, r.data.id)).
```

Also there: `mentionStatusAction(brand, ids, "read"|"new"|"ignored"|"actioned")`, `mentionSentimentAction(brand, id, s)`,
`ticketThreadAction(brand, ticketId)` (card inline thread). Queued: `removeFromQueueAction(brand, ids)`
(`@/app/(app)/cx/inbox/queued/actions`).

## Declutter

Per-user display preferences (table `cx_ui_prefs`, one jsonb doc, loaded server-side in `AppShell` so
there is no flash) apply to both workspaces:

- **Focus mode** (header button, Display menu, Ctrl/⌘ + `\`, Esc exits; a "Focus mode ×" pill shows
  while on): sidebar becomes an icon rail, section panels hide, `<Page>` goes full width and every element with the
  `data-focus-hide` attribute is hidden. **Mark secondary KPI strips, right-hand side panels and
  secondary navigation in your pages with `data-focus-hide`** (wrap in a `<div data-focus-hide>` if needed).
  Primary content must never carry it.
- **Density** comfortable/compact: `data-density="compact"` on the shell shrinks Tailwind's `--spacing`
  inside `<main>` (all `p-*`, `gap-*`, `h-*` utilities) and table/heading text. Use spacing utilities
  rather than arbitrary px values so your page follows it. CSS: `src/components/shell/declutter.css`.
- **Customize menu** (sidebar footer, ≡ menu, Display menu): pin, hide and reorder sidebar items of every
  tab; pinned items show on all tabs; "Reset to default".
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
