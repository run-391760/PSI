# SynapseSEO

An all-in-one SEO and competitive-intelligence platform modelled on Semrush: 35 tools covering
competitive research, keyword research, rank tracking, site audits, backlinks, on-page and content
optimization, local SEO, brand and AI-search visibility, reporting and monitoring.

> **About the numbers.** Semrush-style traffic, keyword and backlink estimates come from web-scale
> indexes that cannot be reproduced on one machine. SynapseSEO is honest about provenance: every
> report carries a source badge. Without API credentials, index-based metrics come from a
> deterministic **demo engine** (labelled "Demo data"). Connect DataForSEO to get live index data,
> and several tools use real, free sources out of the box (see below).

## Quick start

```sh
cd ~/SynapseSEO
npm install
npm run dev          # http://127.0.0.1:3200
```

Create an account at `/register` (the first account needs no invite in development), then search a
domain or keyword from the top bar, or create a project to unlock the monitoring tools.

## Tools

| Area | Tools |
|---|---|
| Home | Dashboard (search, project widgets, onboarding checklist, SERP volatility), Projects, project dashboards with schedules and jobs |
| Competitive research | Domain Overview, Traffic Analytics (single + compare up to 5), Organic Research (positions, position changes, competitors, pages, subdomains), Keyword Gap, Backlink Gap, Market Explorer |
| Keyword research | Keyword Overview (single + bulk), Keyword Magic Tool (match types, questions, groups, filters), Keyword Strategy Builder (lists, SERP-overlap clustering, pillar pages), Position Tracking, Organic Traffic Insights (your Search Console + GA4 data by landing page and query) |
| Link building | Backlink Analytics (overview, backlinks, anchors, referring domains/IPs, indexed pages, outbound, competitors, compare), Backlink Audit (toxicity, disavow file), Link Building Tool (prospects, outreach pipeline, live link monitor), Bulk Analysis (200 targets) |
| On-page & tech SEO | Site Audit (real crawler, 60+ checks, thematic reports, Core Web Vitals), On Page SEO Checker, SEO Content Template, Log File Analyzer |
| Local SEO | Listing Management, Map Rank Tracker (geo-grid), Review Management |
| Content | Topic Research, SEO Writing Assistant, Brand Monitoring |
| AI search | AI Visibility (prompt tracking across AI engines, AI-crawler readiness) |
| Advertising | Advertising Research (paid positions, ad copies, ads history), PPC Keyword Tool (campaign/ad-group planner, Google Ads Editor CSV) |
| Monitoring & reports | SERP Sensor, Alerts (notification center + rules), My Reports (branded, printable PDF), Activity (jobs + API spend) |

Everywhere: sortable/filterable tables with CSV export, 24-month trends, regional databases (20
countries), light/dark themes, mobile layouts, ⌘K global search.

## Data sources

| Source | Used for | Needs |
|---|---|---|
| **Live crawl** (built-in, SSRF-safe, robots.txt respected) | Site Audit, On Page SEO Checker page facts, Link Building monitor, Writing Assistant URL import, AI-crawler readiness | nothing |
| **Google Autocomplete** | Real keyword ideas in the Keyword Magic Tool | `ENABLE_AUTOCOMPLETE` (on by default) |
| **PageSpeed Insights** | Core Web Vitals in Site Audit | `ENABLE_PAGESPEED` (on), optional `PAGESPEED_API_KEY` |
| **Google News RSS** | Brand Monitoring mentions | `ENABLE_NEWS_MENTIONS` (on) |
| **Your files** | Log File Analyzer (Apache/Nginx logs, .gz), CSV keyword imports | nothing |
| **Google Search Console + GA4** (OAuth, read-only) | Organic Traffic Insights, project widget: real clicks, impressions, queries, positions, organic sessions, key events | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_SECRET` |
| **AI engines with web search** | AI Visibility live answers: ChatGPT (OpenAI Responses API), Gemini (Interactions API + Google Search), Perplexity (Agent API), Claude (Anthropic SDK), Google AI Overviews (DataForSEO SERP) | `OPENAI_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY`, `ANTHROPIC_API_KEY`, DataForSEO |
| **DataForSEO** (paid) | Domain, keyword, SERP, backlink and rank data | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` |
| **Demo engine** | Everything else when no paid provider is configured: traffic, rankings, backlinks, local listings/reviews, sensor, other AI engines | nothing — always labelled "Demo data" |

The demo engine (`src/lib/seo/engine`) is deterministic and internally consistent: a keyword has the
same volume and difficulty in every tool, a domain's position in Organic Research matches the SERP
shown in Keyword Overview, and reloads show the same numbers.

### Connecting Google Search Console and GA4

1. In Google Cloud Console enable the **Google Search Console API**, **Google Analytics Data API** and
   **Google Analytics Admin API**, and configure the OAuth consent screen.
2. Create an OAuth client (**Web application**) with redirect URI
   `<APP_ORIGIN>/api/integrations/google/callback` (e.g. `http://localhost:3200/api/integrations/google/callback`).
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_ORIGIN` and `APP_SECRET`, restart, open the app at
   `APP_ORIGIN`, and use **Organic Traffic Insights → Connect Google account**, then link each project to
   its Search Console and GA4 properties.

## Configuration

Copy `.env.example` to `.env.local` and restart the server.

```dotenv
DATABASE_URL=                 # empty = embedded PostgreSQL (PGlite) in .data/postgres
APP_ORIGIN=http://localhost:3200
ALLOW_SIGNUPS=true            # production: set false and use SIGNUP_INVITE_CODE
DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=
GLOBAL_API_BUDGET_USD=50      # monthly cap across the deployment
MAX_MONTHLY_API_USD=50        # per-user cap (each user can lower theirs in Settings → Budget)
ENABLE_AUTOCOMPLETE=true
ENABLE_PAGESPEED=true
ENABLE_NEWS_MENTIONS=true
PAGESPEED_API_KEY=
ANTHROPIC_API_KEY=            # AI Visibility: Claude
OPENAI_API_KEY=               # AI Visibility: ChatGPT (OPENAI_MODEL, default gpt-6-astra)
GEMINI_API_KEY=               # AI Visibility: Gemini (GEMINI_MODEL, default gemini-3.8-flash)
PERPLEXITY_API_KEY=           # AI Visibility: Perplexity (PERPLEXITY_PRESET, default low)
GOOGLE_CLIENT_ID=             # Search Console + GA4 OAuth client (Web application)
GOOGLE_CLIENT_SECRET=
APP_SECRET=                   # encrypts stored OAuth tokens (required in production)
LOCAL_WORKER=true             # run background jobs inside the web process
```

Paid calls reserve their worst-case cost in a spend ledger before they run, are cached in
`provider_cache`, and stop when a monthly budget is reached (see Activity → Data usage).

## Architecture

- **Next.js 16** App Router (Turbopack), React 19, TypeScript, Tailwind CSS 4 design tokens,
  Recharts 3. Server components call data modules directly; mutations are server actions.
- **Database:** PostgreSQL via PGlite (single process, file-backed) or `DATABASE_URL`. The schema is
  idempotent SQL split per module in `src/lib/schema/`.
- **Background jobs:** a durable job table with leases, retries and cancellation, a scheduler for
  daily/weekly monitors (rank checks, site audits, backlink audits, brand mentions, link monitoring),
  and an in-app notification center. The worker starts from `src/instrumentation.ts`.
- **Modules:** `src/lib/<module>` (data + jobs + dashboard widget), `src/app/(app)/<tool>` (pages),
  `src/components/<module>` (client UI). Conventions are documented in `docs/BUILD-BRIEF.md`.

```
src/
  app/(auth)            sign in / sign up
  app/(app)/<tool>      35 tool routes
  app/api               job progress, uploads, exports
  components/ui|charts  design system (tables, charts, dialogs, metrics)
  components/seo        KD/intent badges, SERP feature icons, data-source badge
  lib/seo/engine        deterministic demo data engine
  lib/providers         DataForSEO, autocomplete, PageSpeed, news, Claude, cache + provenance
  lib/jobs              queue, worker, scheduler, registry
  lib/crawler.ts        SSRF-safe fetcher, robots.txt, link/HTML parsing
```

## Verify

```sh
npm run typecheck
npm test                      # demo-engine consistency tests
npm run test:e2e              # every route renders without console/server errors (dev server running)
node scripts/shot.mjs /tmp/shots /dashboard "/domain-overview?q=nike.com"   # screenshots
```

## Deployment notes

- PGlite is single-process: run one web process, or set `DATABASE_URL` to a managed PostgreSQL.
- Background monitors need an always-on host (not a request-only serverless platform).
- Put the app behind HTTPS, set `APP_ORIGIN` to the public origin, disable open signups, and keep API
  keys in environment secrets. Back up the database.

## Known limitations

- Demo-engine numbers are illustrative, not measurements; connect DataForSEO for live index data.
  DataForSEO mappings are implemented but have not been exercised against a live account.
- Listing Management, Map Rank Tracker, Reviews, SERP Sensor and non-Claude AI engines have no free
  real-data source and run on the demo engine.
- The crawler reads server-rendered HTML; JavaScript-only content is not rendered.
- Reports export through the browser's print-to-PDF; there is no scheduled email delivery.
