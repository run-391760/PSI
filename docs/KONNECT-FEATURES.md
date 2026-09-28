# Konnect Insights: feature inventory and gap analysis

Research date: 2026-09-28. This is a reference for building equivalent functionality under our own brand.
Do not copy their name, logo, screenshots, copy text or UI assets (see `docs/CX-BRIEF.md`).

## How this was built

- **Sources read in full:** all 17 release-note pages (Aug 2023 → Jul 2026) from
  `release-notes-sitemap.xml`, every product/module page in `page-sitemap.xml` (ticketing, CXM,
  listening, analytics, publishing, BI, surveys, social CRM, command centre, crisis, QA, Konnect AI+,
  Agent Empower, KRC + trust layer + integration guide, pricing, compliance, Salesforce, Genesys, Front
  Office OS), the public API catalogue behind developer.konnectinsights.com (`/GetApiData`, 25
  endpoints), the Fivetran connector schema, and product blog posts.
- **Partially available:** G2, Capterra, Zendesk Marketplace and Gartner returned 403 errors, so only
  their search-result snippets were used. The FAQ page loads its content with JavaScript and was empty.
  No YouTube or webinar transcripts were found.
- **Rule used:** a feature is listed only if a cited page describes it. Menu paths are quoted as
  published (for example `Settings → Admin → Ticket Settings`).
- **Our code was checked by grepping** `src/app/(app)/cx/**`, `src/lib/cx/**`,
  `src/components/cx/**` and `src/lib/schema/cx*.ts`. It was not read line by line, so a few PARTIAL
  or MISSING marks may need a second look.

**Status legend.** `DONE` means we have an equivalent. `PARTIAL` means some of it exists, and the note
says what is missing. `MISSING` means we have nothing for it. **3P** means the feature needs a
third-party API, credentials or approval that we don't have yet (Meta, X, LinkedIn, TikTok, Google
Business Profile, telephony, SMS, Salesforce and so on). We can build the plumbing and the UI, but it
stays behind a connect card until someone configures a key.

Source keys (for example `[RN2607]`) are reference links. The URLs are listed at the end of the file.

---

## 1. Their terminology

| Their term | Meaning / where used | Our nearest term |
|---|---|---|
| **Monitor** | Top-level operational module (tickets, queues, settings live under it) [RN2403] | `/cx/inbox` |
| **Tickets / All Messages** | Main ticket list ("Ticketing View") [RN2404] | Inbox list |
| **Queued Tickets / Queued Messages** | Push-assigned per-agent queue with active/break status [RN2503][RN2412] | — (none) |
| **My Tasks** | Tickets assigned to the current user for action; has own escalation matrix [RN2404] | "Mine" view |
| **One Ticket View** | Full ticket screen; split into *Public Messages* and *Private Messages* tabs [RN2309] | Conversation pane |
| **Ticket View / Chat View / Conversational View** | List layouts; Conversational View has *Left-Right Aligned* and *Left Aligned* modes [RN2408][RN2603] | Single layout |
| **Topic** | A listening query/keyword set; tickets & mentions belong to Topics [API] | `cx_topics` |
| **Profile / Social Profile** | A connected brand account (FB page, X handle, mailbox…) [API] | `cx_channels` |
| **Cluster** | Grouping of topics/profiles used for reporting/API scope [API][RN2412] | — |
| **Group** | Account/workspace container (`groupid` in every API call) [API] | Brand (= project) |
| **Omni-Channel Setup** (formerly *Social Profile*) | Channel connection admin [RN2411] | Settings → Channels |
| **Profiles with / without Login Credential** | Owned (authenticated) vs public-tracked (e.g. competitor) profiles [RN2401][RN2607] | — |
| **BYOC** (Bring Your Own Channel) | Custom channel via API [RN2503] | Web form / webhook (partial) |
| **All Apps** | Integration marketplace inside settings [RN2401] | — |
| **Classification** (parent → child → sub-child) | Hierarchical ticket categorisation, with sentiment per level (`Classification1..3`, `Classification1Sentiment`) [API][RN2503] | Tags (flat) |
| **Additional Info Field** | Admin-defined typed ticket fields (input, multiline…), can be mandatory, validated, encrypted [RN2506][RN2408] | — |
| **Custom Info Field** | Hierarchical master-data picklists (`CustomFilterMaster`), bulk uploadable [RN2408] | — |
| **Severity** | Ticket severity (separate from priority) [API][RN2503] | Priority |
| **Commenter Type / Commenter Level** | Author classification (politician, doctor…) and influence level [API][RN2411] | — |
| **Conversation Type** | Admin-defined conversation type picklist [API] | Intent (auto) |
| **Media Type** | Channel sub-type, e.g. "Facebook Comments", "Public Tweets", DM, mention [API][RN2404] | channel_kind |
| **Case Type** | New vs repeat case (`CaseType: "New"`) [API] | — |
| **CRM Status** | Open, Assigned, Work In Progress (**WIP**), Follow-up, Resolved, Closed, Responded, Ignored, Assigned FollowUp/Resolved/WIP [API] | new/open/pending/on_hold/solved/closed |
| **Reopen** | Ticket returns to open on customer reply (configurable for WIP) [RN2411] | Auto-reopen on reply |
| **TAT** | Turn-around time; configured in *TAT Settings* [RN2506] | SLA policy |
| **FRT / ART / ERT / RT / Resolved TAT / Reply TAT / Close TAT** | First response, average response, every response, resolve time, etc. [RN2309][RN2512][RN2607] | FRT, resolution |
| **SLA / SLA Breach / SLA Priority – Highest First** | Breach thresholds and queue sort [RN2503][RN2512] | SLA policies, breached view |
| **Business Hours / Non Business Hours / Calendar Hours** | Operational-hours basis for TAT [RN2412] | Business hours + holidays |
| **Queue Assignment Type** | Round Robin, Round Robin (One by One), Round Robin (Availability), Equal, Priority [RN2603][RN2607] | — |
| **Custom User Status** | Agent availability states such as "Lunch Break", with time limits [RN2607] | — |
| **Quick Action** | Admin-defined macro for bulk reply/close/classify/assign [RN2503] | — |
| **Automation** (Set Rules / Set Actions) | Rule engine per *Social Type* (e.g. "Social Public Media", "Custom Profile") [RN2408][RN2412] | Routing/tag rules |
| **Draft Message Templates** | Canned responses (supports tables and dynamic placeholders) [RN2406][RN2509] | Canned replies |
| **Escalate via Email / Auto Escalate** | Email escalation to internal teams [RN2411][RN2503] | — |
| **DM Link** | Move a public conversation private [PRC] | — |
| **Content Tags / User Defined Tags** | Tags on posts for analytics [RN2406][RN2408] | Campaigns |
| **KISS** | Konnect Insights Smart Suggestions (analytics recommendations) [PRC][RN2509] | — |
| **Konnect AI+** | AI layer: *AI Essentials*, *Agent Empower*, *KRC* [KAI] | `lib/cx/ai.ts` |
| **KRC** (Konnect Research Cloud) | Natural-language CX intelligence for leadership; MCP connector [KRC][KRCI] | — |
| **Command Centre** | Wall-display real-time dashboards with themes [DCC] | — |
| **Streams** | Social wall of scrolling posts across profiles [RN2607] | — |
| **Quality Assessment**: Evaluation Form, Coaching Form, Assessment, Feedback, Supervision, All Evaluations | QA module sections [RN2411] | Scorecards, reviews |
| **Super Admin / Admin / Agent / Quality Assessor / Supervisor** | Roles mentioned [RN2309][RN2411] | admin/supervisor/agent/viewer |

---

## 2. Module inventory and gap analysis

### A. Platform shell, navigation and account settings

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| A1 | Group → Topic / Profile / Cluster hierarchy | API scopes everything by groupid + topic/profile/cluster | [API][FT] | PARTIAL | Brand ≈ group; topics and channels exist; no clusters |
| A2 | Multi-language UI | English, Arabic, Spanish, French, Portuguese; per-user setting in My Profile | [RN2506] | MISSING | English only |
| A3 | RTL layout for Arabic | Full UI RTL + auto RTL cursor in reply editor | [RN2506][RN2603] | MISSING | |
| A4 | Notifications page (bell → View More) | With media/channel filter | [RN2607] | PARTIAL | Global `notify()` exists; no CX notification centre with channel filter |
| A5 | Sound alert on new tickets (per user) | My profile → Alert me on tickets | [RN2403] | MISSING | |
| A6 | Sound alert on new message in Conversational View | | [RN2509] | MISSING | |
| A7 | "Normal date" toggle | Absolute timestamps instead of "2 hours ago" | [RN2512] | MISSING | We show relative time |
| A8 | Custom sentiment colours | RGB/HSL/HEX; applied in reports and charts | [RN2603] | MISSING | |
| A9 | Multi-brand management | Advanced plan | [PRC][CXM] | DONE | Brand switcher (project = brand) |
| A10 | Data residency (EU, US, UAE, KSA, UK, DE) | Hosting options | [KRC][ANN] | MISSING | Infrastructure item; out of scope |
| A11 | Platform identifier on every conversation | Channel icon under the avatar | [RN2309] | DONE | Channel badge on tickets |

### B. Channels (Omni-Channel Setup)

| ID | Channel | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| B1 | Email: Gmail, Microsoft/Outlook OAuth | "9 email sources"; Outlook folder sync; choose a folder on reply/close | [RN2411][RN2403][OCT] | PARTIAL | IMAP/SMTP only; no OAuth, no folder sync (3P for OAuth) |
| B2 | Facebook (comments, DMs, posts, reviews) | Reply, hide, delete, block | [RN2404][RN2509] | PARTIAL 3P | Meta webhook mapping exists (`webhooks.ts`); needs app credentials |
| B3 | Instagram (DMs, comments, tags, mentions, public posts) | | [RN2408] | PARTIAL 3P | Same as B2 |
| B4 | X / Twitter (mentions, DMs, public tweets, enterprise data) | Hide reply, block/mute, 4,000-char replies for premium | [RN2311][RN2412][PRC] | PARTIAL 3P | Catalogue entry only |
| B5 | LinkedIn (comments, mentions, tagged-post comments) | @mention users in replies | [RN2311][RN2403] | PARTIAL 3P | Catalogue entry only |
| B6 | YouTube (comments, public videos, held comments) | Publish held comments | [RN2412][RN2509] | PARTIAL | Listening source only; no reply |
| B7 | WhatsApp Business (Tech Provider, templates) | Messages become tickets; reply with pre-approved templates; "3 types" | [RN2412][OCT] | PARTIAL 3P | Webhook mapping exists; no template picker |
| B8 | Threads | Account via Instagram login | [RN2412] | MISSING 3P | |
| B9 | TikTok (publish, comments, analytics) | | [RN2506] | MISSING 3P | |
| B10 | Pinterest | | [RN2506] | MISSING 3P | |
| B11 | LINE Messenger | | [RN2401] | MISSING 3P | |
| B12 | Viber | Via All Apps | [RN2411] | MISSING 3P | |
| B13 | Telegram (alerts group; chat channel) | | [RN2503][OCT] | MISSING 3P | Free bot API; feasible |
| B14 | Discord (bot token, server, channels, threads; lock/close thread) | 5–10 min delay | [RN2503] | MISSING 3P | Free bot API; feasible |
| B15 | Discourse forum (domain + API key) | Topics + replies, 30 min delay | [RN2503] | MISSING | Free API; feasible |
| B16 | Google Business Profile reviews + locations | Location grouping and filters | [RN2404][RN2607] | MISSING 3P | |
| B17 | App Store reviews (iOS, reply via Issuer ID/Key ID/private key) | | [RN2311] | PARTIAL | RSS listening only; no reply (3P) |
| B18 | Play Store reviews (reply) | | [OCT][PRC] | PARTIAL 3P | Catalogue only |
| B19 | Trustpilot, e-commerce reviews, consumer forums, Quora | "8 review platforms" | [OCT][ZD] | MISSING 3P | |
| B20 | Live chat web widget | Branded widget, AI bot → human handoff, proactive triggers | [OCT][RN2411] | PARTIAL | Widget with typing and presence exists; no bot handoff or proactive triggers |
| B21 | Calls (6+ telephony: Twilio, Exotel…; recordings; AI call summary; IVR→ticket) | | [OCT][RN2411] | MISSING 3P | |
| B22 | BYOC: custom channel via API (SMS, proprietary messaging) | Agents reply from Konnect | [RN2503][RN2411] | PARTIAL | Web form + inbound webhooks; no generic two-way BYOC API |
| B23 | QR-code feedback, website form data | via BYOC | [RN2411] | PARTIAL | Web form channel exists |
| B24 | AirSewa (Indian aviation grievance portal) | Receive, reply, forward to airport | [RN2408] | MISSING 3P | Niche |
| B25 | Web results, news, blogs, forums, podcasts, Reddit | Listening sources | [SL][OCT] | PARTIAL | Google News, HN, Reddit, Mastodon, Bluesky, YouTube, App Store; no blogs/forums/podcasts |
| B26 | Surveys and webhooks as channels | | [OCT] | PARTIAL | Survey comments stored; no survey→ticket |
| B27 | Facebook Reply Profile Mapping | Default reply-from profile | [RN2607] | MISSING 3P | |
| B28 | Hide other brand handles when replying (X mapping) | | [RN2506] | MISSING 3P | |

### C. Ticketing: list, views, search, bulk

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| C1 | Unified inbox across channels | Counts per channel tab (All / Email / Social / Chat / Calls / WhatsApp) | [OCT] | PARTIAL | Unified list + channel filter; no per-channel count tabs |
| C2 | Ticket View vs Chat View toggle | Top-right "Change View" | [RN2408] | MISSING | One layout |
| C3 | Conversational View (customer-merged; public + private; history; user analytics; journey; notes; commenter type; activities) | | [RN2411] | PARTIAL | Contact profile + history; no commenter type or user analytics tab |
| C4 | Left-Right vs Left Aligned message layout; also in My Task | | [RN2603][RN2607] | PARTIAL | Left-right bubbles only; no toggle |
| C5 | Email threads collapsed, latest first | Native email style | [RN2603] | MISSING | |
| C6 | Show assigned agent, email subject and attachment icon in Conversational View | | [RN2512] | PARTIAL | Assignee and subject shown; no attachment indicator in list |
| C7 | One Ticket View: Public Messages / Private Messages tabs | Toggle in Ticket Settings | [RN2309] | MISSING | |
| C8 | Search within search (field-name autocomplete for Additional/Custom fields) | | [RN2406] | MISSING | Free-text `q` only |
| C9 | Search by Post ID / URL syntax | | [RN2309] | MISSING | |
| C10 | Filters: platform/media type, date range, profiles, topics, status | | [RN2404] | PARTIAL | Channel, priority, status, sentiment, team, tag; no date range, profile or topic |
| C11 | More Filters: escalated; email sent / reply received / not sent | | [RN2404] | MISSING | |
| C12 | Sort: SLA Priority – Highest First | | [RN2503] | PARTIAL | "SLA breached" view; no nearest-deadline sort |
| C13 | Bulk select (customer icon) → bulk download | Excel of selected tickets with filters | [RN2404] | MISSING | No ticket export |
| C14 | Bulk hide/delete Facebook comments | | [RN2404] | MISSING 3P | |
| C15 | Bulk assign / status / priority / tag | | [RN2503] | DONE | Inbox bulk bar |
| C16 | Queue timer beside ticket (green <10 min, red after) | Ticket Settings → Show Queue Timer | [RN2603] | PARTIAL | SLA badge only; no queue-age timer |
| C17 | TicketingViewMaster: group tickets (e.g. by GMB location) | Admin-defined grouping views | [RN2404] | MISSING | Fixed views only |
| C18 | Saved views: Mine / Unassigned / Breached | | [RN2411] | DONE | 7 views |
| C19 | Date range lock for queued messages ("Can change the date") | | [RN2412] | MISSING | |
| C20 | Show X post details (likes/retweets; like/retweet) | | [RN2408] | MISSING 3P | |

### D. Ticket lifecycle and actions (One Ticket View)

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| D1 | Statuses: Open, Assigned, WIP, Follow-up, Resolved, Closed, Responded, Ignored, Reopened | | [API] | PARTIAL | new/open/pending/on_hold/solved/closed; no Ignored, WIP or Follow-up semantics |
| D2 | Mandatory status change with reply (no "Reply only") | Toggle | [RN2512] | PARTIAL | Reply can carry a status (`sendStatus`); cannot be enforced |
| D3 | WIP → auto reopen on customer reply | Toggle | [RN2411] | DONE | Auto-reopen on inbound |
| D4 | Assign to someone, with media attachment | | [RN2404] | PARTIAL | Assign exists; no attachment on assignment |
| D5 | Ticket notes with @user tagging and notification | | [RN2401] | PARTIAL | Internal notes; no @mention notification |
| D6 | Media on ticket notes (PDF, video, GIF, image, Excel) | | [RN2404] | MISSING | Notes are text only |
| D7 | Ticket reminders (pop-up; multiple users; edit/delete; min 10 min; logged) | 3-dot → Set Reminder | [RN2404][RN2408] | MISSING | |
| D8 | Merge tickets (same platform, different media types) | | [RN2509] | DONE | `mergeAction` |
| D9 | Parent–child tickets (parent stays open until children close) | | [RN2509] | MISSING | |
| D10 | Parent–child notes merged into one view | | [RN2607] | MISSING | |
| D11 | Ticket locking N days after close (no edit or reopen) | | [RN2607] | MISSING | |
| D12 | Create ticket manually, with a Reset button | | [RN2506] | DONE | `newTicketAction`; reset not needed |
| D13 | Ticket activity log (who did what, including reminders) | API TicketActivity / TicketActions with ActionTAT | [API][RN2408] | DONE | `cx_inbox_events`; no per-action TAT |
| D14 | Collision: one agent at a time; "Continue" override | | [RN2509][RN2607] | PARTIAL | Viewer/typing indicator only; no lock or "Continue" |
| D15 | Escalate via Email (To/CC/BCC with suggestions, signature) | | [RN2411][RN2412] | MISSING | |
| D16 | Auto Escalate via Email if no action within the timeframe | | [RN2503] | MISSING | |
| D17 | Email Forward (remove original attachments, inline attachments) | | [RN2408] | MISSING | |
| D18 | Compose Mail from ticket (ticket ID in subject) | | [RN2509] | MISSING | |
| D19 | Domain/email restriction for compose/escalate/forward | | [RN2603] | MISSING | |
| D20 | Set severity | API PATCH severity | [API] | PARTIAL | Priority only |
| D21 | Sentiment change (manual override, logged) | API event "Sentiment Changed" | [API] | MISSING | Sentiment is auto-only on tickets |
| D22 | Classification pop-up after reply | Toggle "Enable classification after reply" | [RN2406] | MISSING | |
| D23 | Mandatory field highlight on classify | | [RN2408] | MISSING | |
| D24 | Google Meet scheduling from Contact Info | | [RN2403] | MISSING 3P | |
| D25 | Conversation History download | | [RN2411] | MISSING | |
| D26 | Facebook deleted-comment prompt (block reply) | | [RN2311] | MISSING 3P | |

### E. Reply composer and agent productivity

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| E1 | Draft Message Templates per profile (canned) | | [RN2406] | DONE | Canned replies + picker |
| E2 | Table in draft template (email) | | [RN2406] | MISSING | Plain text |
| E3 | Bulk upload/download of templates (sample file) | | [RN2411] | MISSING | |
| E4 | Dynamic placeholders (Additional/Custom Info fields) | | [RN2509] | PARTIAL | {{name}}, {{first_name}}, {{ticket}}, {{brand}}, {{agent}}; no custom fields |
| E5 | Per-user email signature with images | My Profile → Add signature | [RN2403][RN2411] | MISSING | |
| E6 | Hyperlink text in replies | | [RN2403] | MISSING | Plain textarea |
| E7 | Attach media to replies (My Task / tickets) | | [RN2404] | MISSING | Inbound attachments displayed; no outbound upload |
| E8 | Paste screenshot into reply (Ctrl+V) | | [RN2607] | MISSING | |
| E9 | Audio attachments (Meta) | | [RN2607] | MISSING 3P | |
| E10 | Audio-to-text dictation in reply box | | [RN2607] | MISSING | Browser speech API; feasible |
| E11 | Enter to send (Conversational View) | | [RN2607] | PARTIAL | Cmd/Ctrl+Enter |
| E12 | AI: fix spelling and grammar; translate reply | | [RN2412] | PARTIAL | AI suggest reply only (needs key) |
| E13 | Real-time inbound message translation (90+ languages) | | [RN2506] | MISSING | Needs AI key |
| E14 | Bitly short links in DM replies | | [RN2401] | PARTIAL | Own shortener exists in Publishing; not in inbox |
| E15 | DM Link: take public conversation private | | [PRC] | MISSING 3P | |
| E16 | Reply publicly vs privately (X public tweet → DM) | | [RN2506] | MISSING 3P | |
| E17 | Approvals for replies | | [PRC] | MISSING | |
| E18 | Macros | | [PRC] | MISSING | See Quick Actions (G8) |
| E19 | Reply-on-reply for email threads | | [RN2603] | MISSING | |
| E20 | LinkedIn @mention in replies | | [RN2403] | MISSING 3P | |

### F. Moderation actions on social

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| F1 | Hide / delete / like comments (also via Quick Actions) | | [RN2404][RN2607] | MISSING 3P | |
| F2 | Hide replies on brand tweets | | [RN2311] | MISSING 3P | |
| F3 | X block/mute status check; unmute | | [RN2403] | MISSING 3P | |
| F4 | Block user: X DM, Facebook DM and comments | | [RN2509][RN2512] | MISSING 3P | |
| F5 | YouTube held comments → publish to public | | [RN2509] | MISSING 3P | |
| F6 | Discord lock/close thread | | [RN2503] | MISSING 3P | |

### G. Automation, Quick Actions, CSAT automation

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| G1 | Automation rules by Social Type / profile / platform | "Social Public Media", "Custom Profile", YouTube public videos, IG/X public posts | [RN2408][RN2412] | PARTIAL | Route/tag rules on channel/keyword/subject/intent/sentiment/language/domain |
| G2 | Rule conditions: classification, sentiment, keywords, media type, Additional Info, Custom Info, character-length (=n, <n, >n, <=n) | | [RN2403][RN2503][RN2408][GEN] | PARTIAL | No classification, custom-field or length conditions |
| G3 | Actions: auto reply (draft template, inline image), auto close/resolve, classify, set severity, set custom info, fill Additional Info, assign | | [RN2403][RN2503][PRC] | PARTIAL | Team, assignee, priority, tags; no auto-reply or auto-close |
| G4 | Non-business-hours auto action | "Auto Action (Non Business Hours)" in API sample | [API] | MISSING | |
| G5 | Rating/context-based review replies (GMB, iOS, Play) | | [PRC] | MISSING 3P | |
| G6 | Activate/deactivate automation from UI; test rules | | [RN2509] | DONE | Toggle + `testRulesAction` |
| G7 | Clone automation to another profile | | [RN2607] | MISSING | |
| G8 | Quick Actions: admin-defined bulk reply/close/classify/assign/follow-up/WIP/auto-tag; hide/delete/like | 3-dot → Quick Action | [RN2503][RN2607] | MISSING | |
| G9 | CSAT automation by classification / Additional / Custom field | | [RN2408] | PARTIAL | Auto-send on every solved ticket only |
| G10 | Auto-remove from queue on WIP/Follow-up/Resolve | | [RN2406] | MISSING | No queue |
| G11 | AI auto-replies, auto severity, auto classification | Advanced plan | [PRC] | PARTIAL | Auto sentiment/intent/language only |
| G12 | Automated actions on social campaigns | | [PRC] | MISSING 3P | |

### H. Queue, assignment and workforce

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| H1 | Queue assignment types: Round Robin, RR One by One, RR Availability, Equal, Priority (sticky previous agent) | | [RN2603][RN2607] | MISSING | Rules can assign a fixed agent only |
| H2 | Queued Tickets screen with Active/Pause status | | [RN2503] | MISSING | |
| H3 | Custom user statuses (breaks, meetings) with durations | Admin → Custom User Status | [RN2607] | MISSING | |
| H4 | SLA break-time notification (over-long break → email) | | [RN2607] | MISSING | |
| H5 | Reset My Queue on status change (timed) | | [RN2503] | MISSING | |
| H6 | Smart Queue Cleanup (unworked tickets → Unassigned after N min) | | [RN2607] | MISSING | |
| H7 | Admin pauses an agent's queue (availability control) | | [RN2512] | MISSING | |
| H8 | Customer Segments for prioritising queue flow | | [RN2607] | MISSING | |
| H9 | User Groups with time zone; tickets distributed by time zone | | [RN2503] | PARTIAL | Teams exist; no per-team timezone |
| H10 | Queue page size, office start/end per user | API ActiveUsersInQueue | [API] | MISSING | |
| H11 | Agent shifts and out-of-office scheduler | | [PRC] | MISSING | |
| H12 | Supervisor and Agent views | | [PRC] | PARTIAL | Roles exist; no dedicated supervisor board |

### I. Classification and custom data model

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| I1 | Hierarchical classification (parent/child/sub-child) with sentiment per level | | [API][RN2503] | MISSING | Flat tags |
| I2 | Account-level vs topic-level classification | | [RN2408] | MISSING | |
| I3 | Classification import/export (Excel) | | [RN2408] | MISSING | |
| I4 | Hide classification branch from agents (eye icon) | | [RN2503] | MISSING | |
| I5 | Additional Info fields (input, multiline resizable, mandatory, 20-digit/regex validation, encryption) | | [RN2408][RN2506] | MISSING | |
| I6 | Custom Info Fields: hierarchical masters + Excel import | `CustomFilterMaster` | [RN2408][RN2404] | MISSING | |
| I7 | Search bar inside Custom/Additional fields | | [RN2309] | MISSING | |
| I8 | Commenter Type / Commenter Level / Conversation Type picklists | | [API][RN2411] | MISSING | |
| I9 | Severity picklist | | [API] | PARTIAL | Priority (4 fixed levels) |
| I10 | Contact custom fields ("customised contact info") | | [SCRM] | PARTIAL | `attributes` jsonb exists; no admin field definitions |
| I11 | PII encryption (email/phone hidden; eye reveal logged) | | [RN2408] | MISSING | |

### J. SLA / TAT and escalation

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| J1 | SLA by priority, channel or customer tier | | [OCT][BLOG-SLA] | PARTIAL | By priority only |
| J2 | FRT, ERT (every response), RT breach minutes; 1-min detection | | [RN2512] | PARTIAL | FRT + resolution; no ERT/next-response |
| J3 | Multiple TAT settings by date range (up to 3 per day), record log, yearly view | | [RN2506] | MISSING | |
| J4 | TAT per user group/time zone | | [RN2506] | MISSING | |
| J5 | Business / non-business / calendar hours; holidays | | [RN2412][PRC] | DONE | Hours + holidays + timezone |
| J6 | TAT precision HH:MM:SS in exports | | [RN2412] | PARTIAL | Stored precisely; no export |
| J7 | TAT calculated from publish date vs queue-assigned date | | [RN2412] | MISSING | |
| J8 | My Task escalation matrix (classification/sentiment/severity/media/custom fields; levels; internal and external recipients) | | [RN2404] | MISSING | |
| J9 | Pre-breach alerts (tiers) and automated escalation | | [OCT][BLOG-SLA] | PARTIAL | `cx_inbox_sla_alerts` notifies; no tiers or escalation target |

### K. Social CRM / contacts

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| K1 | Contact capture (email, phone) from any channel | | [SCRM] | DONE | `cx_contacts` |
| K2 | Merge contact records sharing an email/phone | Auto + manual | [SCRM] | PARTIAL | Manual merge; email unique index; no auto-merge on phone |
| K3 | Conversation history across channels | | [RN2404] | DONE | Contact profile |
| K4 | User Journey (asc/desc; last 30/60/180 days) | | [RN2411] | PARTIAL | History list; no sort or window filters |
| K5 | User notes | | [RN2411] | DONE | `cx_contact_notes` |
| K6 | User analytics per customer (sentiment trend) | | [RN2411][BLOG-OV] | PARTIAL | Basic counts |
| K7 | Identify loyalists, influencers, detractors | | [BLOG-OV] | MISSING | |
| K8 | One View Of Customer: Contacts header + Excel export | | [RN2408] | DONE | Contacts table CSV |
| K9 | Social profiles by contact lookup (API) | | [API] | MISSING | No public API |
| K10 | External API fetch into ticket/contact (e.g. order status) | Admin → External APIs (GET/POST) | [RN2503] | MISSING | |
| K11 | Purchase and service records on profile | | [CXM] | MISSING 3P | Needs CRM/order integration |

### L. Reports, dashboards and BI

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| L1 | Custom dashboards with Add Chart → widget library | | [RN2309] | DONE | Widget builder, 5 sources, 5 chart types |
| L2 | Dashboard built on chosen classification/Additional/Custom fields | | [RN2403] | MISSING | Depends on I1/I5 |
| L3 | Dashboard filters (classification, additional, custom) | | [RN2411] | PARTIAL | Widget filters: channel, sentiment, priority, status, tag |
| L4 | Per-chart custom date range | | [RN2311] | PARTIAL | Per-widget trailing days only |
| L5 | Chart settings: groups, topics/profiles/clusters, media filter, show-by, TAT-from, operational hours | | [RN2412] | PARTIAL | groupBy + filters |
| L6 | Widget: TAT Summary (FRT/ART/resolution by interval) | | [RN2309][RN2408] | PARTIAL | FRT/ART KPIs; no summary table by interval |
| L7 | Widget: Reply TAT | | [RN2408] | MISSING | |
| L8 | Widget: Daywise FRT (business/calendar hours) | | [RN2412] | PARTIAL | FRT grouped by date |
| L9 | Widget: TAT Analysis (ART or Resolved TAT; user/day/media/profile-wise) | | [RN2412] | PARTIAL | FRT/ART by agent/channel/date |
| L10 | Widget: FRT by Additional/Custom field | | [RN2311] | MISSING | |
| L11 | Widget: Buzz Trend Comparison (month vs same month last year) | | [RN2311] | MISSING | |
| L12 | Widget: Platform Summary (reach, impressions, engagement, followers) | | [RN2311] | MISSING 3P | |
| L13 | Widget: Agent-wise Queue Mention Analysis (open/reopened/WIP per agent) | | [RN2401] | MISSING | |
| L14 | Widget: Sunburst Country → State → City | | [RN2404] | MISSING | We have country on mentions only |
| L15 | Widget: Customised word cloud with 2-word and 3-word phrases | | [RN2404] | PARTIAL | Term cloud of single terms |
| L16 | Widget: Twitter Comparison Overview | | [RN2406] | MISSING 3P | |
| L17 | Widget: Social Media Performance (multi-profile) | | [RN2406] | MISSING 3P | |
| L18 | Widget: Top Performing Posts by engagement rate | | [RN2408] | MISSING 3P | |
| L19 | Widget: Cumulative Reach / Engagement over time | | [RN2408] | MISSING 3P | |
| L20 | Widget: Posts Tagged/Mentioned In | | [RN2411] | MISSING 3P | |
| L21 | Widget: Additional Info Field Sentiment Scale (out of 100%) | | [RN2503] | MISSING | |
| L22 | Share of Voice with classification/field filters | | [RN2411] | PARTIAL | SOV on listening dashboard |
| L23 | Reports → Ticketing Reports: Ticket Trend (monthly sort) | | [RN2607] | PARTIAL | Date grouping by day |
| L24 | Reports → SLA Breach: agent-wise breach chart | | [RN2607] | PARTIAL | SLA compliance KPI; no agent breakdown |
| L25 | Reports → User Performance (all actions; auto vs manual) | | [RN2607] | PARTIAL | Agent leaderboard |
| L26 | Reports → My Dashboard (login time, break time, Reply TAT, FRT, Close TAT, assigned/closed/resolved today) | | [RN2607] | MISSING | |
| L27 | CSAT Report (agent-wise CSAT sent, Excel) | | [RN2506] | PARTIAL | Survey panels; no agent breakdown |
| L28 | Quality Assessment Report | | [RN2411] | PARTIAL | QA panels |
| L29 | Download module: templates (Quick Report, custom-header templates, Competitor Posts) | Monitor → Download | [RN2411][RN2506] | MISSING | No ticket/message export |
| L30 | Scheduled data downloads by email (yesterday / 7 / 30 / 31 days / current month) | | [RN2311] | MISSING | |
| L31 | Share dashboards as live links | | [BI] | MISSING | `shared` means shared inside the workspace only |
| L32 | Downloadable charts; customisable themes | | [SA][DCC] | PARTIAL | CSV per widget; no image/PDF; no themes |
| L33 | Per-chart AI analysis (~120-word insight) | | [SL] | MISSING | Needs AI key |
| L34 | Omni-channel report; agent performance; SLA reports | | [PRC] | PARTIAL | Overview + widgets |

### M. Social listening

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| M1 | Topics with boolean keyword queries (brand + competitor) | | [PRC][SL] | DONE | Topics with AND/OR, exclusions, kinds |
| M2 | 50+ sources, 190+ languages | | [SL] | PARTIAL | 7 free sources; script-based language detection |
| M3 | Dashboard: Share of Voice (buzz trend, period compare, relative SOV) | | [SL] | PARTIAL | SOV + buzz trend; no period-over-period compare |
| M4 | Dashboard: Sentiment (split, trend, word cloud per sentiment) | | [SL] | PARTIAL | Trend + split; cloud not split by sentiment |
| M5 | Dashboard: Classification analysis (current vs prior) | | [SL] | MISSING | Depends on I1 |
| M6 | Dashboard: Media type analysis (volume by source, peak windows) | | [SL] | PARTIAL | Sources chart; no peak windows |
| M7 | X report / Instagram report (reach, hashtags, influencers, retweet velocity) | | [SL] | MISSING 3P | |
| M8 | Review monitoring: star rating trend, drop alerts | | [SL] | PARTIAL | App Store RSS; no rating trend or alert |
| M9 | UGC dashboard: media posts + request consent to reuse | | [RN2403][SL] | MISSING | |
| M10 | Mention → ticket; assign; respond | | [SL] | DONE | `createTicketAction` |
| M11 | Manual sentiment / label on mention; bulk actions | | [RN2311] | DONE | `labelMentionAction`, `bulkMentionsAction` |
| M12 | Influencer / top authors / amplifiers | | [SL][CRI] | PARTIAL | Top authors by followers and mentions |
| M13 | Competitor tracking (SOV, sentiment, campaigns) | | [SL] | DONE | Competitor topics |
| M14 | Tagged-post comments capture (on request) | | [RN2311] | MISSING 3P | |
| M15 | Historical data backfill | | [SL][DCC] | PARTIAL | Only what sources return |
| M16 | Quick Search | Advanced plan | [PRC] | PARTIAL | Feed search |

### N. Alerts, crisis management and command centre

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| N1 | Configure Alerts: type, name, channel, profiles, media filters, search terms, format (text/Excel), immediate or delayed, active hours, BCC | Profile → Configure Alerts | [RN2408][RN2411] | PARTIAL | Crisis notify on/off only |
| N2 | Brand Post Alert (when brand posts) | | [RN2408] | MISSING 3P | |
| N3 | Alert delivery via email, mobile app, Slack (group/user), Telegram (bot, ≥10 min) | | [RN2408][RN2503] | PARTIAL | In-app/email notify only; Slack and Telegram webhooks are free |
| N4 | Spike alerts: volume or negative-sentiment threshold | | [SL][CRI] | DONE | z-score spike detection |
| N5 | Sentiment velocity, predictive risk score by topic/region/channel | | [CRI] | PARTIAL | Peak z per event; no risk score |
| N6 | Auto-escalation of crisis to ticket queue / team | | [CRI] | PARTIAL | Owner field; no auto-ticketing |
| N7 | Crisis events timeline, notes, status | | [CRI] | DONE | Events, notes, open/monitoring/resolved |
| N8 | AI-assisted response templates in crisis | | [CRI] | MISSING | |
| N9 | Recovery tracking 30/60/90 days vs pre-crisis baseline | | [CRI] | MISSING | |
| N10 | Debrief report (what/why/response/impact) | | [CRI] | MISSING | |
| N11 | Crisis playbook builder | | [CRI][BLOG-OV] | MISSING | |
| N12 | Competitor crisis/recovery benchmarking | | [CRI] | MISSING | |
| N13 | Command Centre: real-time wall display, themes, custom widgets | | [DCC][BLOG-OV] | MISSING | |
| N14 | Streams social wall (boards → streams → profiles; share from wall) | | [RN2607] | MISSING | Can use mentions feed (free) |

### O. Social analytics (owned profiles)

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| O1 | Post metrics (engagement, impressions, reach, views, video views) | | [SA] | PARTIAL 3P | Per-post likes/views from adapters when connected |
| O2 | Stories and Reels insights (incl. IG reel watch time) | | [SA][RN2401] | MISSING 3P | |
| O3 | Post-type analytics and Engagement by Post Type | | [SA][RN2408] | MISSING 3P | |
| O4 | Organic vs paid; Brand post vs Ad post filter (LinkedIn, FB) | | [SA][RN2404] | MISSING 3P | |
| O5 | Page level: followers, growth, demographics (IG age/gender) | | [SA][RN2311] | PARTIAL | Daily followers/views/posts in `cx_pub_stats` |
| O6 | Campaign insights / content tags (user-defined tags: engagement rate and breakdown) | | [SA][RN2406][RN2411] | PARTIAL | Campaigns + short-link clicks |
| O7 | Hashtag analytics | | [SA] | MISSING 3P | |
| O8 | Configurable engagement-rate formula (X metrics; Threads) | | [RN2408][RN2512] | MISSING | |
| O9 | Quote-tweet metrics | | [RN2408] | MISSING 3P | |
| O10 | Competitor analytics (public profiles; GMB and Play Store coming) | | [RN2408][RN2607][RN2506] | MISSING 3P | |
| O11 | Industry benchmark (follower growth, engagement rate, posting frequency by country) | | [RN2503] | MISSING | Needs a benchmark dataset |
| O12 | Smart Suggestions (best time, best/worst days, fan interaction) | | [RN2509][PRC] | MISSING | Computable from our own post results |
| O13 | IG summary: Accounts Engaged, Content Interactions | | [RN2503] | MISSING 3P | |
| O14 | GMB charts (star breakdown, new reviews, avg rating, direction requests, website/call clicks) + location filter | | [RN2506][RN2607] | MISSING 3P | |
| O15 | Google Analytics charts (active users by country, city, language, minute, device, demographics, top channel) | | [RN2509][RN2512] | MISSING 3P | GA4 Data API (free) |
| O16 | Short-link click analytics | (not in their material) | — | DONE (ours) | Extra feature |

### P. Social publishing

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| P1 | Compose once for multiple profiles; per-platform attachments/variants | | [PUB][RN2503] | DONE | Variants per network |
| P2 | Networks: FB, X, IG, YouTube, LinkedIn, TikTok, GMB, Threads, Pinterest | | [PUB][RN2506] | PARTIAL 3P | FB, IG, LinkedIn, X, YouTube adapters |
| P3 | Content calendar; post directly from calendar | | [PUB][RN2311] | DONE | Calendar with reschedule |
| P4 | Draft → approval → schedule; multi-approver (all must approve) | | [PUB][RN2506] | PARTIAL | Single approver; require-approval toggle |
| P5 | Asset library; send asset for approval; 1 GB free storage | | [PUB][RN2603] | PARTIAL | Asset library with tags; no asset approval |
| P6 | Asset storage integrations: Amazon S3, OneDrive, Google Drive | | [RN2506][RN2607] | MISSING 3P | |
| P7 | Bulk scheduling via Excel template (guide, upload status, errors) | | [RN2408] | DONE | `bulkUploadAction` (CSV) |
| P8 | AI caption suggestions from keywords | | [RN2309] | DONE | `suggestCaptionsAction` (needs key) |
| P9 | Prompt-based text + image generation | | [RN2506] | PARTIAL | Text only |
| P10 | AI best time to post (per profile) | | [RN2506] | MISSING | |
| P11 | Hashtag recommendations | | [PUB] | MISSING | |
| P12 | Device preview per platform | | [PUB] | DONE | Phone preview |
| P13 | URL shortening | | [PUB] | DONE | Short links with UTM |
| P14 | Campaign management | | [PUB] | DONE | Campaigns |
| P15 | Post status filter (Failed) + failure email + edit and reschedule | | [RN2403] | PARTIAL | Failed status + reschedule; no failure email |
| P16 | Post Type filter (Text, Story, Reel, Poll) | | [RN2607] | MISSING | |
| P17 | Post Activity history | | [RN2503] | PARTIAL | `cx_pub_comments` kinds log transitions |
| P18 | First comment (FB, LinkedIn) | | [RN2403] | DONE | |
| P19 | Feed targeting (FB age/location/language; LinkedIn seniority/company size/industry…) | | [RN2503] | MISSING 3P | |
| P20 | Disable comments (IG, LinkedIn) | | [RN2503] | MISSING 3P | |
| P21 | IG collaborators; FB Reel collaborators | | [RN2403][RN2506] | MISSING 3P | |
| P22 | IG custom thumbnail; FB Stories; Reels | | [RN2404] | MISSING 3P | |
| P23 | Video title/category (FB, LinkedIn); captions SRT (LinkedIn, X); YouTube category + privacy | | [RN2412][RN2503][RN2506] | MISSING 3P | |
| P24 | LinkedIn: documents (PDF/DOC/PPT), multiple GIFs, @mention followers, events, video thumbnail | | [RN2408][RN2406][RN2506][RN2311] | MISSING 3P | |
| P25 | X: polls, reply restriction, Super Followers, image user tagging, 25,000 chars (premium) | | [RN2401][RN2311][RN2506][RN2411] | MISSING 3P | |
| P26 | Threads: polls, ghost posts | | [RN2506][RN2603] | MISSING 3P | |
| P27 | GMB: offers (dates, voucher, redeem link, T&C); location management (create/update/verify) | | [RN2406][RN2607] | MISSING 3P | |
| P28 | Copyright check for reels (IG/FB) | | [RN2503] | MISSING 3P | |
| P29 | Image edit/crop (pixel sizes, aspect presets) | | [RN2412] | MISSING | Client-side; feasible |
| P30 | Delete published posts (LinkedIn, Threads) | | [RN2607] | MISSING 3P | |
| P31 | Role permissions: add/set content tag | | [RN2408] | PARTIAL | author/approver roles |
| P32 | Duplicate post; manual-publish mark | (ours) | — | DONE (ours) | Extra |

### Q. Surveys and CSAT/NPS

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| Q1 | CSAT and NPS surveys | | [SUR][PRC] | DONE | csat / nps / custom |
| Q2 | Survey builder: background image | | [RN2404] | MISSING | |
| Q3 | Thank-you page: custom text or redirect to a custom page | | [RN2411] | PARTIAL | Custom text; no redirect |
| Q4 | Survey categories: Email CSAT, CSAT | | [RN2603] | PARTIAL | Kinds exist |
| Q5 | Email inline CSAT (rating buttons in the email body; number rating only) | | [RN2603] | MISSING | |
| Q6 | CSAT settings: send on email, subject, email template, trigger Resolved/Closed, mandatory send, reply-to-latest | | [RN2603] | PARTIAL | Auto-send link on solve (hourly) |
| Q7 | Send CSAT by email for social tickets (needs captured email) | | [RN2603] | PARTIAL | Link can be pasted into a reply; no email dispatch for social |
| Q8 | Multi-channel distribution (email, social, website) | | [SUR] | PARTIAL | Public link + per-ticket link |
| Q9 | Survey analytics and shareable reports | | [SUR] | PARTIAL | Panels + CSV; no shareable report |
| Q10 | Rating on ticket (API Rating field) | | [API] | DONE | `csat` on ticket |
| Q11 | SurveySensum integration | | [RN2412] | MISSING 3P | |

### R. Quality assessment

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| R1 | Evaluation forms: categories, criteria, weightage | | [RN2411][QA] | PARTIAL | Scorecards with sections; check weightage support |
| R2 | Response types: Input, Scale, Scale with text, Auto Scale | | [RN2411][QA] | PARTIAL | Verify which types exist |
| R3 | Form tied to user group; "Due in days"; auto-accept | | [RN2411] | MISSING | |
| R4 | Coaching forms (separate from evaluation) | | [RN2411] | PARTIAL | Free-text `coaching` field |
| R5 | Assessment tags | | [RN2411][QA] | MISSING | |
| R6 | Assessment queue: filter by agent, date, TAT; Start Assessment | | [RN2411] | PARTIAL | Random sampling by count/days/agent/channel |
| R7 | Select supervisor on assessment | | [RN2411] | MISSING | |
| R8 | AI Summary of the conversation | | [RN2503] | PARTIAL | AI prescore (needs key); check summary |
| R9 | AI assessment view / auto-score every interaction (100% coverage) | | [RN2506][QA] | PARTIAL | AI prescore per review, not bulk |
| R10 | Agent feedback: accept, or reject with remarks | | [RN2411][QA] | DONE | Dispute + resolve |
| R11 | Agent-wise Coaching View (ticket count, avg score, recommended form); assign coaching | | [RN2411] | MISSING | |
| R12 | Supervision: rejected feedback + completed coaching | | [RN2411] | PARTIAL | Disputed reviews list |
| R13 | All Evaluations (admin) | | [RN2411] | DONE | Reviews list |
| R14 | Notifications/emails to agent on new evaluation | | [RN2411] | MISSING | |
| R15 | Personal score trends; early-warning flags for declining agents | | [QA] | MISSING | |
| R16 | Compliance detection (policy breach, tone warning) | | [QA] | MISSING | Needs AI key |
| R17 | Fatal error / pass score | (ours) | — | DONE (ours) | |

### S. AI (Konnect AI+: AI Essentials, Agent Empower, KRC) and chatbot

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| S1 | Auto-classification and tagging | | [KAI] | PARTIAL | Rule tags; intent rule-based |
| S2 | Sentiment, severity, urgency, emotion (sarcasm, frustration) | | [KAI][BLOG-AI] | PARTIAL | Lexicon sentiment; no severity or emotion |
| S3 | Instant conversation summaries | | [KAI][AE] | MISSING | AI key needed |
| S4 | Smart routing by language/intent/channel | | [BLOG-OV] | DONE | Rules on language/intent/channel |
| S5 | Suggested replies grounded in knowledge base with source shown | | [AE] | PARTIAL | `suggestReply` (no KB grounding) |
| S6 | Auto-drafted full responses | | [AE] | PARTIAL | Same as S5 |
| S7 | Tone and quality guidance | | [AE] | MISSING | |
| S8 | CSAT prediction | | [AE][KAI] | MISSING | |
| S9 | Next best action + one-click actions (classify, set severity, escalate) | | [AE] | MISSING | |
| S10 | Custom signal fields (churn risk, upsell, escalation likelihood, VIP) predicted per ticket | | [AE] | MISSING | |
| S11 | Summaries of ticket + customer history + cross-channel identity | | [AE] | MISSING | |
| S12 | Trending-issue alert ("14 tickets mention X, 3× trend") | | [OCT] | MISSING | Computable without AI |
| S13 | Churn risk / predictive churn | | [CXM][KRC] | MISSING | |
| S14 | KRC: natural-language Q&A over own data | | [KRC] | MISSING | |
| S15 | KRC: scheduled executive briefs (weekly/monthly) | | [KRC] | MISSING | |
| S16 | KRC: MCP server URL for Claude/ChatGPT connectors | | [KRCI] | MISSING | |
| S17 | Trust layer: AI sees only aggregated query results; tenant isolation; PII masking | | [KRCT][KRC] | MISSING | Design constraint for S14 |
| S18 | AI chatbot / AI agents 24/7 with human handoff | Separate product (KonnectBot / KonnectChat AI) | [OCT][KAI] | MISSING | |
| S19 | Emerging theme / topic clustering | | [CXM][BLOG-OV] | PARTIAL | Top terms |

### T. Knowledge base

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| T1 | Internal knowledge base: articles, categories, subcategories (Admin) | | [RN2509][RN2607] | MISSING | |
| T2 | KB as grounding for AI replies | | [AE] | MISSING | |

### U. Users, roles, security and admin

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| U1 | Roles: Super Admin, Admin, Agent, Quality Assessor, Supervisor | | [RN2309][RN2411] | PARTIAL | admin/supervisor/agent/viewer |
| U2 | Custom roles with page permissions | Create New Role → Page Permissions | [RN2412] | MISSING | Fixed roles |
| U3 | Granular rights: CRM actions (Assigned, Follow-Up, Resolved, Closed, WIP) | | [RN2311] | MISSING | |
| U4 | Rights: public reply vs private reply | | [RN2412] | MISSING | |
| U5 | Rights: add/set content tag; download attachments | | [RN2408] | MISSING | |
| U6 | User groups (teams) | | [RN2503][RN2411] | DONE | Teams |
| U7 | Invite users | | — | DONE | By email |
| U8 | Bulk user management | | [PRC] | MISSING | |
| U9 | IP whitelisting (Super Admin) | | [RN2309][PRC] | MISSING | Platform-level item |
| U10 | Allowed domains | | [PRC] | MISSING | |
| U11 | 2FA via SMS (account-level) | | [RN2506][PRC] | MISSING 3P | SMS provider needed; TOTP is free |
| U12 | SSO | | [PRC][CXM] | MISSING 3P | Platform-level item |
| U13 | Audit logs | | [PRC] | PARTIAL | Ticket events only |
| U14 | Data masking / PII encryption with view log | | [RN2408][PRC] | MISSING | |
| U15 | Profile: compose email from profile (separate window, drafts, sent, templates) | | [RN2403][RN2406][RN2408] | MISSING | |

### V. Integrations, marketplace and API

| ID | Feature | Detail | Src | Status | Our state / gap |
|---|---|---|---|---|---|
| V1 | Webhooks (real-time events; 10 retries then auto-deactivate) | Admin → Webhooks | [RN2503] | MISSING | We only receive webhooks |
| V2 | External APIs (GET/POST mapped to ticket or contact) | | [RN2503] | MISSING | |
| V3 | REST API: groups, topics, profiles, clusters, messages, classifications, severity, commenter type/level, conversation type, additional info, create ticket, ticket note, custom ticket note, ticket actions, classify, resolve, set severity, set custom info, social profiles by contact, active users in queue, ticket activity, social messages by platform, YouTube/LinkedIn posts | Token auth (account_token + user_token) | [API] | MISSING | No public CX API |
| V4 | Fivetran connector (tables: GROUPS, TOPIC, PROFILE, CLUSTER, MESSAGE_TOPIC/PROFILE/CLUSTER, CLASSIFICATION, SEVERITY, CONVERSATION_TYPE, COMMENTER_TYPE, COMMENTER_LEVEL, ADDITIONAL_INFO, REVIEWS) | | [FT] | MISSING 3P | |
| V5 | Salesforce: push tickets by rule or manually, field/object mapping, status sync, respond in SF, contacts, conversation history | | [SF][ANN] | MISSING 3P | |
| V6 | Genesys Cloud: route tickets to flows by automation, SSO users, act in Genesys | | [GEN] | MISSING 3P | |
| V7 | Zendesk app, Freshworks app, Zapier, HubSpot, Zoho, Microsoft Dynamics | | [ZD][BLOG-AI][KRC] | MISSING 3P | |
| V8 | Slack, Telegram (alerts) | | [RN2503] | MISSING | Incoming webhooks are free |
| V9 | Bitly | | [RN2401] | PARTIAL | Own shortener |
| V10 | Google Meet, Outlook, Gmail, Google Drive, OneDrive, Amazon S3 | | [RN2403][RN2506][RN2607] | MISSING 3P | |
| V11 | App marketplace with no-code AI-built integrations (read API docs, map fields, generate webhooks; "Log Call" template) | | [BLOG-MKT] | MISSING | |
| V12 | Telephony / chatbot integrations (Twilio, Exotel, Engati) → tickets | | [OCT][BLOG-MKT] | MISSING 3P | |
| V13 | MCP / open APIs for the "Front Office OS" | | [FOS] | MISSING | |

---

## 3. Gap counts by module

These counts come from the status column above. `DONE (ours)` rows are extras we have and they don't
list, so they are not counted. A `PARTIAL 3P` or `MISSING 3P` row counts under its main status.

| Module | Items | DONE | PARTIAL | MISSING | …of which need 3P |
|---|---|---|---|---|---|
| A Platform shell | 11 | 2 | 2 | 7 | 0 |
| B Channels | 28 | 0 | 14 | 14 | 19 |
| C Ticket list / views | 20 | 2 | 7 | 11 | 2 |
| D Ticket actions | 26 | 4 | 6 | 16 | 2 |
| E Reply composer | 20 | 1 | 4 | 15 | 4 |
| F Moderation | 6 | 0 | 0 | 6 | 6 |
| G Automation | 12 | 1 | 5 | 6 | 2 |
| H Queue / workforce | 12 | 0 | 2 | 10 | 0 |
| I Classification / fields | 11 | 0 | 2 | 9 | 0 |
| J SLA / TAT | 9 | 1 | 4 | 4 | 0 |
| K Social CRM | 11 | 4 | 3 | 4 | 1 |
| L Reports / BI | 34 | 1 | 15 | 18 | 6 |
| M Listening | 16 | 4 | 8 | 4 | 2 |
| N Alerts / crisis / command centre | 14 | 2 | 4 | 8 | 1 |
| O Social analytics | 15 | 0 | 3 | 12 | 10 |
| P Publishing | 31 | 8 | 7 | 16 | 13 |
| Q Surveys | 11 | 2 | 6 | 3 | 1 |
| R Quality | 16 | 2 | 7 | 7 | 0 |
| S AI / KRC / bot | 19 | 1 | 5 | 13 | 0 |
| T Knowledge base | 2 | 0 | 0 | 2 | 0 |
| U Roles / security | 15 | 2 | 2 | 11 | 2 |
| V Integrations / API | 13 | 0 | 1 | 12 | 6 |
| **Total** | **352** | **37** | **107** | **208** | **77** |

---

## 4. Prioritized build list: five parallel work packages

Each package owns its own files, so all five can run at the same time. Anything shared goes through
the read-only core (`src/lib/schema/cx.ts`, `lib/cx/ai.ts`, `lib/cx/context.ts`). If a core change is
needed, it goes through the orchestrator first. Within each package, items are listed in priority
order, and 3P items are last (UI plus connect card only).

### WP1: Agent workspace and ticket lifecycle (inbox)

**Owns:** `src/components/cx/inbox/**` (except `automation-client.tsx`), `src/app/(app)/cx/inbox/**`,
`src/app/(app)/cx/contacts/**`, `src/lib/cx/inbox/{store,threading,contacts,email,dispatch,chat,guard}.ts`,
`src/app/api/cx/inbox/**`, `src/app/api/cx/chat/**`, schema `src/lib/schema/cx-inbox.ts`.

1. Ticket status model. Add WIP, Follow-up, Ignored and Reopened semantics, and a
   "status required with reply" setting (D1, D2). The setting's value is stored by WP2.
2. Ticket reminders: per user, pop-up plus notify, edit/delete, logged (D7).
3. Parent–child tickets and merged notes (D9, D10); ticket locking after N days (D11).
4. Outbound attachments: upload, paste screenshot, attach to notes and assignments (E7, E8, D4, D6).
5. @mentions in internal notes with notifications (D5); manual sentiment/severity override, logged (D20, D21).
6. Escalate via email, forward, and compose-from-ticket, with an admin domain restriction list
   (D15, D17, D18, D19); per-user email signature (E5); hyperlinks in replies (E6); reply-on-reply (E19).
7. Views: Ticket/Chat layout toggle, left-aligned mode, collapsed email threads, public/private tabs,
   absolute-date toggle (C2, C4, C5, C7, A7).
8. Filters: date range, profile/channel instance, topic, escalated, email-sent state, "nearest SLA
   first" sort; field-aware search syntax (`field:value`, post id) (C8–C12).
9. Ticket and message export: bulk-selected tickets and conversation-history download (C13, D25).
10. Collision lock with a "Continue" override (D14); sound alerts (A5, A6); Enter-to-send option (E11).
11. User Journey sort plus 30/60/180-day windows; auto-merge contacts on phone number (K4, K2).
12. AI helpers in the composer, hidden when there is no AI key: fix grammar, translate reply,
    translate inbound message, summarise thread (E12, E13, S3); browser dictation (E10).
13. Placeholders for custom fields in canned replies (E4), after WP2 ships field definitions.

### WP2: Admin, automation, queue and SLA engine

**Owns:** `src/app/(app)/cx/settings/**` (automation, team, channels, plus new `fields`, `queue`,
`roles`, `alerts`, `api` pages), `src/components/cx/inbox/automation-client.tsx`,
`src/components/cx/insights/team-settings.tsx`, `src/lib/cx/inbox/{rules,automation,sla,jobs,webhooks}.ts`,
`src/lib/cx/insights/{team,sla}.ts`, new `src/lib/cx/admin/**`, new schema `src/lib/schema/cx-admin.ts`,
`src/app/api/cx/webhooks/**`, and new `src/app/api/cx/v1/**`.

1. **Field model.** Hierarchical classification with sentiment per level, Additional Info fields
   (types, mandatory flag, regex/length validation, encryption), Custom Info masters, severity,
   commenter type/level and conversation type picklists, with Excel/CSV import/export and a hide
   toggle (I1–I9). Expose `getFieldDefs()` and `classifyTicket()` for WP1 and WP5.
2. Automation v2. New conditions: classification, custom/additional fields, message length, business
   hours, social type. New actions: auto-reply template, auto close/resolve, classify, set severity,
   set fields. Also cloning (G1–G4, G7).
3. Quick Actions (admin-defined macros for bulk reply/close/classify/assign) (G8, E18).
4. Queue engine: assignment types (round robin, RR one-by-one, RR availability, equal, sticky
   priority), agent statuses and breaks with limits, break-overrun email, pause agent, reset queue,
   smart cleanup, customer segments, queue timer data, team time zones (H1–H10, C16).
5. SLA/TAT v2: SLA by channel and segment, ERT (every response), TAT start (publish vs queue
   assigned), multiple date-ranged TAT rules with a record log, tiered pre-breach alerts, and an
   escalation matrix (J1–J4, J7–J9); auto-escalate via email (D16).
6. Custom roles with page and action permissions (public/private reply, CRM statuses, download
   attachments, content tags); bulk user import; audit log table (U2–U5, U8, U13).
7. Alerts centre: rules by keyword/profile/media, active hours, delay, text/CSV format, BCC; delivery
   by email, in-app, Slack incoming webhook and Telegram bot (N1, N3, V8).
8. Outbound webhooks with retry-then-deactivate; External API mappings shown on tickets and contacts;
   a public token-auth REST API that mirrors their endpoint set (V1–V3, K9, K10).
9. PII masking with a logged reveal; allowed email domains (I11, U14, U10).
10. 3P: Discord, Discourse and Telegram channel connectors (free APIs) first, then Threads, TikTok,
    LINE, Viber, GBP and telephony connect cards (B8–B16, B21).

### WP3: Listening, crisis, command centre and social analytics

**Owns:** `src/app/(app)/cx/listening/**`, `src/app/(app)/cx/crisis/**`, `src/app/(app)/cx/analytics/**`,
new `src/app/(app)/cx/command/**`, `src/components/cx/listening/**`, `src/lib/cx/listening/**`,
schema `src/lib/schema/cx-listening.ts`.

1. Period-over-period comparison on every listening chart; sentiment-split word clouds; 2- and
   3-word phrase clouds; peak activity windows per source (M3, M4, M6, L15).
2. Classification analysis dashboard for mentions (M5). Uses WP2's `classifyTicket`/field defs through
   a read-only import.
3. Review monitoring: rating trend and a rating-drop alert for App Store/Play sources (M8).
4. UGC board: mentions with media plus a consent-request tracker (M9).
5. Crisis v2: risk score (velocity × negativity × reach), auto-create tickets for crisis mentions,
   recovery curves at 30/60/90 days vs baseline, a debrief report generator, and playbooks (checklists
   attached to an event) (N5, N6, N8–N11).
6. Command Centre: full-screen auto-refresh wall with themes, and a Streams social wall of the live
   mentions feed (N13, N14).
7. Trending-issue detector over tickets and mentions ("N mentions of X, 3× normal") (S12).
8. Social analytics from our own data: smart suggestions (best time and day from post results), a
   configurable engagement-rate formula, and content-tag performance (O6, O8, O12).
9. Buzz Trend Comparison (same month last year) and a geography sunburst for mentions (L11, L14).
10. 3P: GA4 charts, GBP insights, per-network post/story/reel metrics, competitor public-profile
    analytics (O1–O4, O10, O13–O15).

### WP4: Publishing

**Owns:** `src/app/(app)/cx/publishing/**`, `src/components/cx/publishing/**`, `src/lib/cx/publishing/**`,
`src/app/api/cx/publishing/**`, schema `src/lib/schema/cx-publishing.ts`.

1. Multi-approver workflow (all designated approvers must approve), with an approver picker on
   compose (P4).
2. Asset approval flow (send to approval, notify approver); a storage quota display (P5).
3. Post Activity timeline and a failed-post email/in-app notification (P15, P17).
4. Post type field (text, story, reel, poll, document, event) plus a filter (P16).
5. Best-time-to-post suggestions from our own post results; hashtag suggestions from listening top
   terms and past posts (P10, P11).
6. Image edit/crop with pixel sizes and aspect presets (client-side) (P29).
7. AI image generation (when a provider key is set) and prompt-based compose (P9).
8. Excel (xlsx) bulk-scheduling template alongside the existing CSV, with upload status and per-row
   errors (P7).
9. Content-tag permissions (P31).
10. 3P, per-network options as adapter capabilities plus UI fields: first-comment networks, feed
    targeting, disable comments, collaborators, thumbnails, stories/reels, video title/category/SRT,
    YouTube privacy, LinkedIn documents/events, X polls/reply restriction, Threads polls/ghost posts,
    GBP offers/locations, delete published posts, S3/OneDrive/Drive pickers (P19–P28, P30, P6).

### WP5: Insights (BI, reports, surveys, QA, knowledge base, AI intelligence)

**Owns:** `src/app/(app)/cx/dashboards/**`, `src/app/(app)/cx/surveys/**`, `src/app/(app)/cx/quality/**`,
new `src/app/(app)/cx/reports/**` and `src/app/(app)/cx/knowledge/**` and `src/app/(app)/cx/ask/**`,
`src/components/cx/insights/**` (except `team-settings.tsx`), `src/lib/cx/insights/**`
(except `team.ts` and `sla.ts`), `src/app/api/cx/surveys/**`, schema `src/lib/schema/cx-insights.ts`.

1. Reports section. Ticket Trend (daily/weekly/monthly), agent-wise SLA breach, User Performance
   (auto vs manual actions), TAT Summary / Reply TAT / Daywise FRT / TAT Analysis with
   business-vs-calendar hours, and a same-day "My Dashboard" per agent (L6–L9, L23–L26).
2. Download centre. Export templates (quick report, pick-and-rename headers), ticket/message dumps
   with TAT as HH:MM:SS, and scheduled email exports (yesterday / 7 / 30 days / current month)
   (L29, L30, J6).
3. Dashboards v2. Per-widget custom date range, dashboard-level filters on classification and custom
   fields (needs WP2 field defs), public share links with a token, PNG/PDF chart export, and themes
   (L2–L5, L31, L32).
4. New widgets: Buzz/volume comparison, agent-wise queue analysis, custom-field FRT, custom-field
   sentiment scale, phrase word cloud (L10, L13, L21).
5. Surveys v2. Email inline CSAT (rating links in the email body), CSAT settings (subject, template,
   trigger resolved/closed, conditions on classification/fields), a redirect thank-you page, a
   background image, agent-wise CSAT-sent report, and email dispatch for social tickets with a known
   email (Q2–Q7, Q9, G9, L27).
6. QA v2. Separate evaluation and coaching forms, weightage, response types (input, scale, scale+text,
   auto-scale), user-group binding, due days and auto-accept, tags, a supervisor field, an agent-wise
   coaching view with assign-coaching, notifications, score trends and early-warning flags, and a bulk
   AI auto-score with summary when a key is set (R1–R9, R11, R14–R16).
7. Knowledge base: articles, categories and subcategories, search, and a `searchKb()` export for AI
   grounding (T1, T2).
8. AI intelligence (key-gated). Grounded reply suggestions with sources (consumed by WP1), a
   per-chart AI insight, and "Ask" natural-language Q&A over aggregated metrics following the
   trust-layer pattern: the model sees query results, never raw messages. Also scheduled executive
   briefs and an MCP endpoint (S5, S14–S17, L33).
9. Signals: CSAT prediction, churn risk and custom signal fields, computed heuristically from
   sentiment, reopen count and SLA breaches, with an AI override when a key is set (S8, S10, S13).

### Out of scope or last

- Platform-level security (SSO, IP allowlist, 2FA, data residency) belongs to the SEO/app shell, not CX.
- Multi-language UI and RTL (A2, A3) is an app-wide i18n effort.
- Enterprise connectors (Salesforce, Genesys, Zendesk, Fivetran, telephony) need partner accounts.
  The REST API and webhooks from WP2 unblock most of them.

---

## Sources

[RN2308]: https://konnectinsights.com/release-notes/konnect-insights-release-note-august-2023/
[RN2309]: https://konnectinsights.com/release-notes/konnect-insights-release-note-8th-september-2023/
[RN2311]: https://konnectinsights.com/release-notes/konnect-insights-release-note-9th-november-2023/
[RN2401]: https://konnectinsights.com/release-notes/konnect-insights-release-note-8th-january-2024/
[RN2403]: https://konnectinsights.com/release-notes/konnect-insights-release-note-march-2024/
[RN2404]: https://konnectinsights.com/release-notes/konnect-insights-release-note-april-2024/
[RN2406]: https://konnectinsights.com/release-notes/konnect-insights-release-note-june-2024/
[RN2408]: https://konnectinsights.com/release-notes/konnect-insights-release-note-august-2024/
[RN2411]: https://konnectinsights.com/release-notes/konnect-insights-release-note-november-2024/
[RN2412]: https://konnectinsights.com/release-notes/konnect-insights-release-note-december-2024/
[RN2503]: https://konnectinsights.com/release-notes/konnect-insights-release-note-march-2025/
[RN2506]: https://konnectinsights.com/release-notes/konnect-insights-release-note-june-2025/
[RN2509]: https://konnectinsights.com/release-notes/konnect-insights-release-note-september-2025/
[RN2512]: https://konnectinsights.com/release-notes/konnect-insights-release-note-december-2025/
[RN2603]: https://konnectinsights.com/release-notes/konnect-insights-release-note-march-2026/
[RN2607]: https://konnectinsights.com/release-notes/konnect-insights-release-note-july-2026/
[OCT]: https://konnectinsights.com/omni-channel-ticketing/
[CXM]: https://konnectinsights.com/cxm/
[SL]: https://konnectinsights.com/social-listening/
[SA]: https://konnectinsights.com/social-analytics/
[PUB]: https://konnectinsights.com/social-media-publishing/
[BI]: https://konnectinsights.com/dashboards-and-bi-tools/
[SUR]: https://konnectinsights.com/surveys/
[SCRM]: https://konnectinsights.com/social-crm/
[DCC]: https://konnectinsights.com/digital-command-centre/
[CRI]: https://konnectinsights.com/crisis-management/
[QA]: https://konnectinsights.com/quality-assessment/
[KAI]: https://konnectinsights.com/konnect-ai/
[AE]: https://konnectinsights.com/agent-empower/
[KRC]: https://konnectinsights.com/krc/
[KRCT]: https://konnectinsights.com/krc/krc-trust-layer/
[KRCI]: https://konnectinsights.com/krc/krc-integration-guide/
[FOS]: https://konnectinsights.com/front-office-os/
[PRC]: https://konnectinsights.com/pricing/
[CMP]: https://konnectinsights.com/compliance/
[SF]: https://konnectinsights.com/salesforce-integration/
[GEN]: https://konnectinsights.com/genesys-konnect-insights-integration/
[ANN]: https://konnectinsights.com/announcements/
[API]: https://developer.konnectinsights.com/
[FT]: https://fivetran.com/docs/connectors/applications/konnect-insights
[ZD]: https://www.zendesk.com/marketplace/apps/support/253251/konnect-insights/
[G2]: https://www.g2.com/products/konnect-insights/features
[CAP]: https://www.capterra.com/p/178918/Konnect-Insights/
[BLOG-OV]: https://konnectinsights.com/blogs/exploring-konnect-insights-a-comprehensive-overview/
[BLOG-AI]: https://konnectinsights.com/blogs/understanding-konnect-ai-features-and-capabilities/
[BLOG-SLA]: https://konnectinsights.com/blogs/sla-management-omnichannel-ticketing/
[BLOG-MKT]: https://konnectinsights.com/blogs/ai-agents-revolutionising-no-code-integrations-in-the-konnect-insights-app-marketplace/

- The API catalogue was read from `https://developer.konnectinsights.com/GetApiData`, the JSON the
  docs page loads. It lists 25 endpoints and sample responses. Field names from it: `MediaType`,
  `TicketStatus`, `CaseType`, `Classification1..3`, `Classification1Sentiment`, `Sentiment`,
  `Language`, `StarRating`, `IsClassificationAutomated`, `UniqueContactID`. Action events: `Message
  Inbox`, `Classification`, `Sentiment Changed`, `WorkInProgress`, `Resolved`, `Closed`, each with
  `ActionTAT`.
- G2, Capterra and Zendesk returned 403, so only search-result summaries were used. Capterra reviewers
  said auto-assignment of tickets was missing at the time of their review, but the 2025–2026 release
  notes add Queue Assignment Types.
