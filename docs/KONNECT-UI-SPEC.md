# CX workspace: Konnect-style layout and interaction spec

Source: 20 screenshots of the user's own Konnect Insights account (read them; do not copy any person's
name, email, handle or post text from them into code, seed data, tests or docs). This document is the
shared contract for the work packages (WP-K1 … WP-K4) that redesign the CX workspace to match.

## 1. Shell

**Header (dark brand-blue bar, full width):**
- Left: hamburger (≡), then logo plus product name.
- Top tabs: **MONITOR | SOCIAL ANALYTICS | PUBLISH | DASHBOARD**. The active tab is white with an underline; the others are muted.
- Right: global search box, notification bell with an unread badge, and an avatar menu.
- Keep our existing **SEO | CX** workspace switch in the header, next to the logo.

**Hamburger menu:** a slide-in panel of secondary modules.
- Konnect's own items: Configure Alerts, Compose Message, My Profile, My Plan, Mentions Tracker, Command Center.
- Our extra CX modules, grouped:
  - Listening: Mentions, Listening dashboards, Reviews, UGC board, Crisis, Streams.
  - Customers: Contacts, Surveys, Quality, Knowledge base, Ask AI.
  - The CX overview page.
- Logout.

**Left sidebar for MONITOR:** white, uppercase group labels, icon plus label rows, the active row highlighted in a light blue fill.

| Group | Item | Route |
|---|---|---|
| OMNI-CHANNEL TICKETS | Tickets | `/cx/inbox` |
| | Queued Tickets | `/cx/inbox/queued` |
| MESSAGES | All Messages | `/cx/messages` |
| | Bookmarks | `/cx/bookmarks` |
| SETUP | Settings | `/cx/settings` (opens Omni-Channel Setup) |
| | Topics | `/cx/listening/topics` |
| | A/B Testing | `/cx/ab-testing` |
| | Quick Search | `/cx/search` |
| REPORTS | Reports | `/cx/reports` (opens Share of Voice) |
| | Download | `/cx/reports/download` |
| | One-Click Report | `/cx/reports/one-click` |
| | Custom Report | `/cx/reports/custom` |
| TASKS | My Tasks | `/cx/tasks?view=mine` |
| | All Tasks | `/cx/tasks?view=all` |

**Collapsed rail plus secondary panel:** on Settings, Topics and Reports pages, the main sidebar collapses to an icon-only rail (same items, tooltips) and a second panel shows that section's own navigation. Examples: SETTINGS with its items, REPORTS with grouped report links, TOPICS with the topic list.

**Sidebars for the other tabs:**
- SOCIAL ANALYTICS: Overview `/cx/analytics`, plus per-network and best-time sections as they exist.
- PUBLISH: Scheduled Posts `/cx/publishing`, Calendar `/cx/publishing/calendar`, Assets `/cx/publishing/assets`, A/B Testing.
- DASHBOARD: Dashboards `/cx/dashboards` and saved dashboards.

**Tab assignment:** a route belongs to MONITOR unless it starts with `/cx/analytics` (SOCIAL ANALYTICS), `/cx/publishing` (PUBLISH) or `/cx/dashboards` (DASHBOARD). Hamburger-only modules render under MONITOR with no sidebar row highlighted.

The declutter features already built (focus mode, density, hide panels, customize menu) stay. Focus mode collapses the sidebar to the rail and hides the right filter panel.

## 2. Ticket streams (Tickets, Queued Tickets, All Messages, Bookmarks)

### Card
- **Header row:**
  - Avatar with a network badge (Instagram, Facebook, LinkedIn, X, YouTube, …), the author name in bold and the @handle muted.
  - On the right: icons (bookmark/knowledge book, lightning "real-time", grid "related"), then a relative time ("12 minutes ago").
  - Queued tickets add: "Reply" / "Comment", "Remove From Queue", an ASSIGNED badge next to the ticket ID, and the message count at the bottom right.
- **Body:** the latest message. Hashtags are links. Media shows as thumbnails. Long text is clamped with a centred "READ MORE".
- **"FIRST CONVERSATION" block:** a grey panel with a blue corner label and the original post's time ("8 HOURS AGO"). Only shown when the ticket has an earlier message than the latest.
- **Footer row:**
  - "Reply" (DM) or "Comment" (public) on the left.
  - The channel-profile badge ("INSTAGRAM MENTIONS ( PU IG )", "FACEBOOK COMMENTS ( PU FB )", "LINKEDIN MENTIONS ( … )") on the right.
  - On hover, an action toolbar:
    - Ticket details, Create ticket/child, View original (globe), Compose mail.
    - Ignore/spam (block), Sentiment (smiley), Bookmark (book), Assign (user+).
    - Close/resolve (check-circle), Create task (checkbox).
    - A "…" overflow menu.
- **Card bottom bar:** "TICKET ID: n", status badge, chevron to expand the thread inline.
- **All Messages:** the same cards without the ticket bar. It shows every inbound item: ticket messages **and** listening mentions.

### Right FILTER panel
- **CHANGE VIEW** dropdown: Ticket view, Conversational view (Left-Right aligned / Left aligned, each with an info tooltip).
- **Topic / Profile picker:** a searchable multi-select popover with sections:
  - Select Cluster (cluster icon), Select Topic (speech icon) and Select Profile (network icon).
  - Each section has a select-all checkbox.
  - Footer: "Select All", CLEAR and SAVE.
  - The trigger shows the selected names comma-joined and truncated.
- **Date range:** dd/mm/yyyy - dd/mm/yyyy, with presets plus a calendar.
- **Media type multi-select.**
- **Sort:** Date - Latest First / Date - Oldest First.
- **More Filters:** sentiment, status, assignee, priority, tags, language, has attachments, classification.
- **Counter cards**, each with a header total in green; every row is a clickable filter:
  - TICKETING VIEW: Responded Tickets.
  - TICKET STATUS: Opened, Assigned, Responded, Closed.
  - ACTIVE USERS: Queue UnAssigned plus each agent, with an online dot and a pause icon when on break.
  - MEDIA TYPE: News, Blogs, Other - Web, Twitter Public Tweets, Twitter Mentions, Facebook Public Posts, Facebook Tag Posts, Facebook Inbox, Facebook Comments, YouTube, Instagram, Instagram Messages, Instagram Comments, LinkedIn Comments, Google Business Reviews, Instagram Tag Posts, Instagram Mentions, LinkedIn Mentions.
  - PROFILE: each topic and profile with a network icon and a count.

### One Ticket View
`/cx/ticket/[id]?brand=` is a full-page ticket. It shows:
- The header with ticket ID, status, priority, channel-profile badge and SLA.
- The full thread, the composer (reply, comment, private reply, note) and every action: assign, status, sentiment, classification, tags, bookmark, task, child ticket, merge, hide/delete comment, compose mail, escalate, print/download transcript.
- The contact panel and activity.

It reuses the existing inbox conversation component and actions, and it is reachable from every card, drawer item and search result.

## 3. Settings (secondary panel "SETTINGS")

| Item | Route | Content |
|---|---|---|
| Group Details | `/cx/settings/group` | Brand name, logo, domain, timezone, language, business hours link, owner, plan link |
| Omni-Channel Setup | `/cx/settings/channels` | "PROFILES WITH LOGIN CREDENTIALS" (collapsible) with ADD PROFILE. One section per network (X/Twitter, Facebook, YouTube, Instagram, LinkedIn, Google Business, WhatsApp, Email, Live chat, Web form, Telegram, Discord, Discourse…) titled with the network icon and name plus a "n Profiles" count. Each profile is a card: avatar, display name, handle/id, "Active" (green) or an error state, a gear menu (edit, pause, reconnect, delete, change color), "Created by", "Created On" and a "Color" dot. |
| Topics | `/cx/settings/topics` | Table: TOPIC NAME (icon plus name), CONTAINS, AND CONTAINS, DOES NOT CONTAIN, CREATED BY (name, date-time), gear menu. ADD NEW TOPIC. |
| Users | `/cx/settings/users` | Top-right links "IP WHITELISTING" and "ROLE SETTINGS". The Users table has NAME, ROLE, EMAIL with a verified check, CREATED BY with date, and a gear menu. Buttons: UPLOAD USERS (CSV), ADD NEW USER, ADD EXISTING USER. A "Users Group" section has ADD USER GROUP and an empty state. |
| Clusters | `/cx/settings/clusters` | Table: CLUSTER NAME, PROFILES as chips per network ("3 Facebook", "2 Google Business Location", "13 Instagram", "5 LinkedIn", "2 Topic", "1 Twitter", "1 Youtube"), CREATED BY, gear menu (Edit Cluster, Delete Cluster, Edit Color). ADD CLUSTER. The edit dialog has a name field, a "Search Profiles…" box and two lists ("Selected Profiles/Topics" and "Other Profiles/Topics") with »/« move buttons, CLOSE and UPDATE. Clusters are our profile groups and must include topics as well as profiles. |
| More Social Profiles | `/cx/settings/social-profiles` | Public profiles tracked without login (competitors, partner pages), per network |
| Integrated Apps | `/cx/settings/integrations` | Connected connectors, API tokens, webhooks, external APIs |
| All Apps | `/cx/settings/apps` | Catalogue of every channel and app with connect state and cost |
| Admin | `/cx/settings/admin` | Card hub to the existing admin pages: team & SLAs, automation, fields & classification, queue, roles & audit, alerts, API & webhooks, data import, plan & usage |

**Topic editor** (`/cx/listening/topics`):
- Secondary panel "TOPICS" with an info icon, an eye toggle and a refresh icon, and the topic list.
- Page title is the topic name. Buttons top right: duplicate, delete (red) and ADD NEW TOPIC (green).
- Left column "Search Query": the generated boolean query, e.g. `"A" OR "B" …`, with AND/NOT parts.
- Right column:
  - TOPIC NAME with the helper text "This is a label for "Topic" and is for naming purposes only…".
  - CONTAINS, AND CONTAINS and DOES NOT CONTAIN as tag inputs: blue chips with ×, plus an "Add a Keyword" input. Each has helper text.
- Collapsible optional sections: MEDIA PREFERENCE (sources), REGIONAL (countries, languages), EXCLUSIONS (authors, sites), MORE SETTINGS (min followers, verified only, fetch frequency) and OBJECTIVE.
- **Activation** card with a toggle and explanation.
- CANCEL / SAVE.

## 4. Reports (secondary panel "REPORTS")

**Panel header icons:** duplicate, customise, download.

**Panel groups:**
- SOCIAL LISTENING:
  - Share of Voice `/cx/reports/share-of-voice`
  - Sentiment Analysis `/cx/reports/sentiment`
  - Media Type Analysis `/cx/reports/media-type`
  - Twitter Report `/cx/reports/twitter`
  - Instagram Report `/cx/reports/instagram`
  - Classifications `/cx/reports/classifications`
- COMMUNITY ENGAGEMENT:
  - All Task Report `/cx/reports/tasks?view=all`
  - My Task Report `/cx/reports/tasks?view=mine`
  - CSAT Report `/cx/reports/csat`
  - Ticketing Report `/cx/reports/ticketing`
  - Queuing Report `/cx/reports/queuing`
  - My Dashboard `/cx/reports/my-dashboard`
- CALLS ANALYTICS: Overview, Agent Performance, Agent Live Status and Agentwise Report under `/cx/reports/calls?tab=…`. These need a telephony connection, so show the connect state until one exists.

**Report filter bar:** cluster/profile picker (the same component as the ticket panel), date range, media-type multi-select, and "Show By Publish Date / Created Date" where relevant.

### Share of Voice
- **Buzz Trend:** a stats column (scope name with "(C)" for cluster, TOTAL CONVERSATIONS, AVERAGE PER DAY, PEAK DATE, PEAK TIME) next to a smooth line chart. Has a "Sort By Daily / Weekly / Monthly" control and a "…" menu.
- **Overall Sentiment Analysis:** stacked column per scope, with a tooltip of Positive / Negative / Neutral.
- **Relative Share of Voice:** pie, plus TOTAL CONVERSATION, MOST TALKED and LEAST TALKED.
- **Share of Voice Top Posts.**
- **Word Cloud.**

### Sentiment Analysis
- **KPI tiles:** TOTAL, POSITIVE, NEGATIVE, NEUTRAL, each with a % change against the previous equal period (red down / green up) and a scope badge.
- **Sentiment Analysis Over Time:** three lines, plus a stats column (AVG POSITIVE PER DAY, AVG NEGATIVE PER DAY, MOST POSITIVE ON, MOST NEGATIVE ON).
- **Overall Sentiment Analysis:** horizontal 100% stacked bar.
- **Sentiment Scale out of 100 %.**
- **Tiles:** MOST/LEAST POSITIVE/NEGATIVE POSTS, as counts and as %.
- **Pies:** Relative Share of Positive and Relative Share of Negative.
- **Sentiment By Brand:** table.
- **Overall Sentiment Analysis By Media Type (%):** 100% stacked columns per media type.
- **Positive Word Cloud and Negative Word Cloud**, each with MOST USED WORDS chips.
- **Sentiment Current Trends:** a table of Current 7 days / Past 7 days / Previous 7 days, with Positive / Negative / Neutral counts and % change.
- **Lists:** Top Positive Posts and Top Negative Posts.
- **Sentiment Analysis By Brand:** pie.

### Ticketing Report
- **Ticket Statistics tiles:** TOTAL TICKETS, OPEN, WIP, FOLLOW UP, ASSIGNED, ASSIGN PENDING, RESPONDED, FYI, IGNORED, RESOLVED, CLOSED, IRRELEVANT.
- **Reply TAT tiles** (`0D : 2H : 22M` format): AVERAGE REPLY TAT, FIRST REPLY TAT, SECOND REPLY TAT, THIRD REPLY TAT, AVERAGE REPLIES.
- **Ticket Trend:** one line per profile, with a stats column (TOTAL TICKETS, AVERAGE TICKETS PER DAY, PEAK DATE, PEAK TIME).
- **First Time Resolution.**
- **Ticket Tracker:** donut with the total in the centre.

### Interaction rules (every report and chart)
1. **Legend items toggle series.** Clicking "Negative" hides it, and the chart rescales. Tiles and pies honour the same toggles where they share a series.
2. **Every point, bar, slice, tile, table cell, word and list row is clickable.** It opens a **drill-down drawer** that slides in from the right. The drawer's title names the slice ("Negative - 29/09/2026") and its header has filter, download (CSV/XLSX) and close icons.
3. **The drawer lists matching items as compact cards.** Each card shows the avatar with network badge, author, sentiment badge, a details icon and the date link.
4. **Clicking a drawer card opens the One Ticket View** (`/cx/ticket/[id]`). A listening mention that isn't a ticket yet gets a "Create ticket" action, then opens the new ticket. From there the agent can respond, delete or hide, assign, close, and so on.
5. **The "…" menu on each widget:** download PNG, download CSV, view as table, AI insight, and hide widget (declutter).

## 5. Ownership (work packages)
- **WP-K1, shell, navigation and the shared scope picker:**
  - `src/components/shell/*` and `src/components/shell/cx-nav.ts` (top tabs, per-tab sidebars, hamburger menu, rail plus secondary-panel framework exported as `<SectionPanel>`).
  - `src/app/(app)/cx/layout.tsx` if one is needed.
  - The shared `ScopePicker` (cluster/topic/profile popover) in `src/components/cx/scope-picker.tsx` plus its server helper `src/lib/cx/ops/scope.ts`. **Build these first.**
- **WP-K2, monitor streams and One Ticket View:**
  - `src/components/cx/inbox/*`, `src/app/(app)/cx/inbox/*` and `src/lib/cx/inbox/*`.
  - `/cx/messages`, `/cx/bookmarks` and `/cx/ticket/[id]`.
- **WP-K3, settings and topics:**
  - `src/app/(app)/cx/settings/*` (except `inbox` and `reports`) and `/cx/listening/topics`.
  - Settings `layout.tsx` with the SETTINGS secondary panel.
- **WP-K4, reports:**
  - `src/app/(app)/cx/reports/*`, `src/lib/cx/reports/*` and `src/components/cx/reports/*`.
  - The interactive chart kit and drill-down drawer.
  - The REPORTS secondary panel layout.

Shared conventions: real data only (no demo numbers); light and dark themes; 390px works with no horizontal page scroll; reuse `src/components/ui`.
