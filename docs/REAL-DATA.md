# Real-data conversion brief

Goal: **no synthetic numbers anywhere in the product.** Every report shows data from a configured real
source, or a `<NeedsData>` card. Read `docs/BUILD-BRIEF.md` first (file ownership, testing, no npm
install/build/dev/git, never open the DB from scripts); the same rules apply.

## Policy (shared, already implemented — read-only for you)

- `demoAllowed()` in `src/lib/data-mode.ts`: true only when `DEMO_DATA=true` (local development).
  When false, **never call the demo engine (`@/lib/seo/engine`) to produce displayed numbers**, never show
  a "Demo data" badge, and hide stored rows whose source is `demo`. You may keep the demo path behind
  `if (demoAllowed())` so local development still works.
- `providerStatus()` → `{ dataforseo, google, pagespeed, ai, "business-profile", clickstream }` booleans.
  `liveEnabled()` = DataForSEO configured. `googleConfigured()` = Search Console/GA4 access configured.
- `googleProjectForDomain(userId, domain)` → the user's project for that domain with its linked Search
  Console site / GA4 property, or null.
- Google helpers in `src/lib/google/data.ts`: `gscQuery(userId, site, body)` (Search Analytics rows:
  `keys, clicks, impressions, ctr, position`), `ga4Report(userId, property, body)` (GA4 rows), `dateRange(days)`,
  `organicInsights(userId, link, days)` (cached combined GSC+GA4 view), `getProjectGoogle(projectId)`.
  GA4 limits concurrent requests per property: **call `ga4Report` sequentially**. Wrap your own Google
  aggregations in `cached(key, "search-console" | "google-analytics", hours, fn)` (6 h is fine) and never
  cache results that contain errors. Search Console data lags ~2–3 days; use `dateRange()`.
- `<NeedsData providers={[...]} shows={[...]} />` (`@/components/seo/needs-data`): the card to render
  when the needed provider is not connected. `shows` = bullets of what the report contains once connected.
  Use `compact` inside a card/section of an otherwise real page.
- Data source badges: `DataSourceBadge` sources `search-console`, `google-analytics`, `dataforseo`,
  `crawler`, `google-autocomplete`, `google-news`, `user`, AI engine sources. Never `demo` unless demoAllowed().
- Unknown numbers render as "n/a" — never 0 and never an estimate.

## Testing

The shared dev server (http://127.0.0.1:3200) has **no API keys**, so you will mostly see NeedsData
states there — they must look intentional and polished. Google-backed views cannot be exercised live
here: put the mapping from API rows to view models in pure functions and unit-test them with realistic
fixture rows in `tests/<module>-real.test.ts` (run with `npx tsx --test tests/<file>`). Run
`DEMO_DATA=true` code paths only if you keep them; the default must be demo-free.

Check pages with `node scripts/shot.mjs <outDir> <paths>` (EMAIL=<your-account>) — zero console errors,
light/dark, 390px. `npx tsc --noEmit --incremental false` must be clean for your files.

## Definition of done

- No page you own shows synthetic numbers or a "Demo data" badge with `DEMO_DATA` unset.
- Real sources are used wherever applicable (below), with provenance badges.
- Tools without an applicable source show a clear NeedsData card (and keep user-owned features such
  as lists, profiles, prompts, pipelines working).
- Project dashboard widgets (`summary.ts`) report only real data (or state "empty" with a CTA).
- Final report: what is real now per route, what needs which API, shared-file requests, gaps.
