# SynapseSEO — build brief for module developers

SynapseSEO is a Semrush-class SEO platform (Next.js 16 App Router, React 19, Tailwind 4, Recharts 3,
PGlite/PostgreSQL). The foundation is done; each module (a set of tools in the left nav) is built by
one developer working **in parallel with others in the same working tree**. Read this whole file first.

## Golden rules for parallel work

1. **Only edit files you own** (listed in your assignment). Shared files are read-only for you:
   `src/lib/{db,auth,domain,format,utils,csv}.ts`, `src/lib/seo/**`, `src/lib/providers/{source,labels,dataforseo}.ts`,
   `src/lib/jobs/{queue,worker,registry,types}.ts`, `src/lib/projects/**`, `src/components/{ui,charts,shell,seo,projects}/**`,
   `src/app/layout.tsx`, `src/app/globals.css`, `src/app/(app)/layout.tsx`, `src/app/(auth)/**`, `package.json`.
   You MAY add **new** files anywhere inside your own directories. If you truly need a change to a shared
   file (a bug, a missing export, a new engine function), do not edit it — describe the exact change in
   your final report and work around it locally meanwhile (e.g. a helper in your own lib folder).
2. **Do not** run `npm install`, `next build`, `next dev`, `git` commands, or delete `.next`/`.data`.
   Every dependency you need is installed (see package.json). A shared dev server is ALREADY RUNNING at
   http://127.0.0.1:3200 with hot reload — use it for testing.
3. **Never open the database from a script.** PGlite (.data/postgres) is single-process; only the dev
   server may open it. Test DB-backed features through the running app (pages, server actions, routes).
4. Tables: put `CREATE TABLE IF NOT EXISTS …` / `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` in your module's
   file under `src/lib/schema/<module>.ts` (already created and wired). It runs on the live connection
   automatically after hot reload (see `database()` in db.ts). Prefix your table names with your module
   (e.g. `pt_keywords`, `audit_pages`). Reference `projects(id) ON DELETE CASCADE` for project data and
   `users(id) ON DELETE CASCADE` for user data.
5. Type-check with `npx tsc --noEmit 2>&1 | grep -E "<your paths>"` — other modules are mid-edit, so
   ignore errors outside your files. Run `npx next typegen` if `PageProps<"/route">` types are missing.
6. Screenshot your pages: `node scripts/shot.mjs <outDir> "/route?q=..." ["/other"...]` (env FULL=1 for
   full page, THEME=dark, WIDTH=390 for mobile). It signs in as a dev user and prints console errors,
   page errors and HTTP 5xx. Use an outDir under your scratchpad. **Look at the screenshots** (Read the
   png) and fix layout problems. Every page must render with zero console errors in light and dark mode
   and be usable at 390px wide.

## Architecture

- `src/app/(app)/<route>/page.tsx` — server component pages. Read `searchParams` (a Promise) and render.
  Auth: `const user = await requirePageUser()` (from `@/lib/auth`) at the top of every page.
- Mutations: server actions in `src/app/(app)/<route>/actions.ts` (`"use server"`). Always
  `const user = await requireUser()` and verify ownership (`getProject(user.id, id)` throws 404).
  Return `{ ok: true, data } | { ok: false, error }` (see `src/app/(app)/projects/actions.ts`,
  `actionError()` helper). Use `revalidatePath()` or `router.refresh()` after mutations.
- Route handlers (`route.ts`) only for polling (job progress), file downloads/exports and uploads.
- Data/business logic lives in `src/lib/<module>/…` (server-only). Pages call it directly.
- Client interactivity in `"use client"` components under `src/components/<module>/` or colocated in
  the route folder. Pass serializable props only (no functions from server to client).
- Tools that work on a project read `?project=<id>`; without it render `<ProjectGate>` (from
  `@/components/projects/project-gate`) listing projects + create. Use `<ProjectSwitcher>` in the header.
  (`ProjectGate` takes `keep={{ import: "..." }}` to carry extra query params into the chosen project.)
  Tools that analyze any domain/keyword read `?q=` and `?db=` (regional database, `database(code)`).
- Avoid top-level import cycles: never read a constant imported from a module that (indirectly)
  imports `@/lib/jobs/queue` at module top level of your `jobs.ts`; use string literals for job kinds.

## Data sources and honesty (non-negotiable)

Every dataset carries provenance (`Sourced<T>` from `@/lib/providers/source`) and every report shows a
`<DataSourceBadge source fetchedAt />` in its header. Sources:

- **Demo engine** `@/lib/seo/engine` — deterministic synthetic data, consistent across tools: use it for
  anything that needs a web-scale index when no live provider is configured. Key functions:
  `keywordMetrics(k, db)`, `serp(k, db, {extraDomains})`, `expandSeed(seed)`, `topicFor`, `topicUniverse`,
  `domainFacts(domain, db)` (headline metrics + 24-month history), `domainKeywords(domain, db)` (ranked
  keywords sample), `lostKeywords`, `domainCompetitors`, `domainPages`, `domainSubdomains`,
  `countryDistribution`, `paidKeywordRows`, `positionOn(domain, keyword, db, device, isoDate)` (daily rank),
  `referringDomains`, `backlinks`, `anchors`, `linkVelocity`, `toxicity`, `trafficFacts`, `ctrFor`,
  `bucketVolume`, `rng(seed)`/`unit(seed)`/`hash` for your own deterministic generation. Types in
  `@/lib/seo/types`. Wrap results with `demo(data)`. Never mix demo numbers into live results.
  If you need synthetic data the engine doesn't provide, generate it deterministically in your module
  with `rng(\`<purpose>:<inputs>\`)` so reloads show the same numbers.
- **DataForSEO (live, paid)** — when `liveEnabled()`; call `dfs(ownerId, endpoint, payload, maxMicros)`
  with `market(db)`, wrapped in `cached(key, "dataforseo", ttlHours, fn)`. Map fields defensively
  (optional chaining, `?? 0`); missing fields stay empty, never demo. It cannot be tested here (no
  credentials) — keep mappings simple and typed loosely.
- **Real free sources** (implemented for real): the crawler (`@/lib/crawler`: `fetchPublic`, `crawlPage`
  with robots.txt, `parseLinks`, `auditHtml`; SSRF-safe), Google Autocomplete, PageSpeed Insights,
  Google News RSS, uploaded files (logs, CSV), the user's own input. These are labelled with their source.
- Missing is not zero: show "n/a" for unknown values.

## Reference implementation

Study `src/app/(app)/domain-overview/page.tsx` and `src/lib/competitive/domain-overview.ts` first. Match
their quality and density: PageHeader (breadcrumbs, title + subject, badges, actions, ToolSearch), a
metric strip, cards in responsive `Grid`s, charts with legends and time ranges, compact tables linking to
deeper tools (DomainLink → Domain Overview, KeywordLink → Keyword Overview), a demo notice at the bottom.

## UI kit (import, don't re-create)

- Layout: `Page`, `PageHeader`, `Grid` (`@/components/shell/page`).
- `Card, CardHeader(title, description, info, actions, href), CardBody, CardFooter` (`ui/card`).
- `Button, ButtonLink, buttonClass` (`ui/button`) — variants primary/secondary/ghost/danger/link.
- `Badge(tone), Dot, Swatch` (`ui/badge`); `Tooltip, InfoTip` (`ui/tooltip`).
- `Input, Textarea, Select, Label, Field, Checkbox` (`ui/input`).
- `Metric, MetricStrip` (`ui/metric`) — stat tiles with delta.
- `DataTable, CellLink` (`ui/data-table`, client) — sorting, paging, quick filter, selection + bulk
  actions, CSV export. Columns contain render functions → define them in a "use client" component.
- `MiniTable` (`ui/mini-table`, server-safe) for widget tables.
- `TabsNav` (URL `?tab=` tabs; preserves other params), `Tabs` (local), `Segmented` (`ui/tabs`).
- `Dialog, Menu, MenuItem` (`ui/dialog`); `EmptyState, Callout, Skeleton, Spinner` (`ui/feedback`);
  `Bar, ScoreRing, Gauge, DistributionBar` (`ui/progress`); `PrintButton` (`ui/print-button`).
- Charts (client, `components/charts/*`): `TrendChart` (line/area/stacked, `ranges` = MONTH_RANGES /
  DAY_RANGES, `reversed` for rank positions, `markers`), `BarChart` (columns/bars, stacked, valueLabels,
  highlight), `DonutChart` (≤6 segments), `BubbleChart` (positioning map). Formats are strings
  (`yFormat="compact"|"percent"|"money"|"position"|"number"`, `xFormat="month"|"monthShort"|"day"|"raw"`).
  Colors: series slots via `series(i)` / `var(--series-N)` in fixed entity order; status colors
  (`var(--good|warning|serious|critical)`) only for meaning, always with a label. One y-axis only.
  Legends for ≥2 series. Never color text with series colors.
- SEO bits (`components/seo/badges`): `KdBadge`, `kdBand`, `IntentBadges`, `SerpFeatureIcons`,
  `FeatureIcon`, `featureLabel`, `PositionChange`, `TrendBars`, `Sparkline`, `DomainAvatar`,
  `DomainLink`, `KeywordLink`, `AsBadge`. `DataSourceBadge`, `DemoNotice` (`seo/source-badge`).
  `ToolSearch` (q + db form), `DbSwitcher` (`seo/tool-search`).
- Projects: `ProjectGate`, `ProjectSwitcher`, `NewProjectButton`, `ProjectForm` (`components/projects`);
  data: `listProjects`, `getProject`, `findProject`, `updateProjectSettings` (`@/lib/projects`).
- Formatting (`@/lib/format`): `compact, num, pct, money, signed, duration, monthLabel, dayLabel,
  dateLabel, dateTimeLabel, timeAgo, displayUrl, truncateMiddle`. `cn()` in `@/lib/utils`.
  `downloadCsv` in `@/lib/csv` (client).
- Tokens (Tailwind classes): `bg-bg bg-surface bg-surface-2 bg-surface-3 border-border border-border-strong
  text-text text-text-2 text-text-3 text-link bg-brand text-brand-ink bg-brand-soft text-good-ink
  bg-good-soft text-warning-ink bg-warning-soft text-serious-ink text-critical-ink bg-critical-soft
  shadow-card`. Base font 14px; use `text-[13px]`-style sizes like the reference. No raw hex colors
  except inside charts' CSS vars. Dark mode works automatically through tokens.

## Background jobs and monitoring

- Enqueue: `enqueue({ kind: "<module>.<action>", ownerId, projectId, payload, dedupeKey })` from
  `@/lib/jobs/queue`. Register handlers in your `src/lib/<module>/jobs.ts` (`jobs` record). A handler
  `(job, ctx) => result` runs in the server process; call `ctx.progress(done, total, message)` and check
  `ctx.cancelled()` in long loops. Results go to `jobs.result`; store real data in your own tables.
- Recurring: `setSchedule(projectId, kind, { cadence: "daily" | "weekly" | "hourly", payload })`; the
  worker enqueues due schedules every minute. `getSchedule`, `latestJob`, `listJobs`, `cancelJob` exist.
- Alerts: `notify({ ownerId, projectId, tool, severity, title, body, link })` → Alerts page + bell.
- Progress UI: poll a small route handler (e.g. `GET /api/<module>/jobs/[id]`) from a client component
  every 1–2s while status is queued/running, then `router.refresh()`.

## Project dashboard widgets

If your module has project-based tools, implement `src/lib/<module>/summary.ts` (`summaries` array of
`(project) => Promise<ToolSummary>`, type in `@/lib/projects/summary-types`): state "empty" with a CTA
when not set up, otherwise a headline metric (+delta), 2–3 stats, optional sparkline, updatedAt.

## Definition of done

- All routes you own are complete, polished, dense, and consistent with the reference; no placeholders.
- Real interactions work end to end (create, filter, sort, export CSV, run jobs, see progress/results).
- `tsc` clean for your files; screenshots checked (desktop light + dark, and 390px mobile for key pages).
- Final report: routes built, features, data sources (demo vs real), tables added, any shared-file
  change requests, known gaps. Keep it concise.
