/** Report templates, sections and branding palette (client-safe: no server imports). */

export type TemplateId = "domain" | "project" | "backlinks" | "comparison";
/** Data providers a template/section needs (mirrors Provider in data-mode; client-safe). */
export type NeedsProvider = "dataforseo" | "google";
export type SectionDef = { id: string; label: string; description: string; default?: boolean; needs?: NeedsProvider; source?: string };
export type TemplateDef = {
  id: TemplateId;
  name: string;
  short: string;
  description: string;
  /** What the report is about: any domain, or one of the user's projects. */
  subject: "domain" | "project";
  competitors?: boolean;
  /** Provider every section of this template needs (web-scale index data). */
  needs?: NeedsProvider;
  sections: SectionDef[];
};

export const TEMPLATES: TemplateDef[] = [
  {
    id: "domain",
    name: "Domain overview report",
    short: "Domain overview",
    description: "Authority, organic and paid traffic, keywords, competitors and backlinks of any domain.",
    subject: "domain",
    needs: "dataforseo",
    sections: [
      { id: "summary", label: "Key metrics", description: "Authority Score, organic & paid traffic, keywords, referring domains.", default: true },
      { id: "traffic", label: "Traffic trend", description: "Organic and paid traffic over 12 months.", default: true },
      { id: "positions", label: "Keyword positions", description: "Keywords by position band and their trend.", default: true },
      { id: "keywords", label: "Top organic keywords", description: "Keywords that bring the most traffic.", default: true },
      { id: "intents", label: "Search intent & branded traffic", description: "Keyword intent mix and branded share." },
      { id: "countries", label: "Traffic by country", description: "Organic traffic split by regional database." },
      { id: "competitors", label: "Main organic competitors", description: "Domains competing for the same keywords.", default: true },
      { id: "pages", label: "Top pages", description: "Pages that attract the most organic traffic." },
      { id: "paid", label: "Paid search", description: "Paid keywords and estimated ad spend." },
      { id: "backlinks", label: "Backlink profile", description: "Referring domains trend and top referring domains.", default: true },
    ],
  },
  {
    id: "project",
    name: "Project SEO report",
    short: "Project SEO",
    description: "Status of every tool in one of your projects plus visibility, competitors and backlinks.",
    subject: "project",
    sections: [
      { id: "summary", label: "Project summary", description: "Domain, market, competitors and Search Console headline metrics.", default: true, source: "Project settings · Search Console" },
      { id: "tools", label: "Tool widgets", description: "Site Audit, Position Tracking and other tool results.", default: true, source: "Your tools" },
      { id: "search", label: "Search performance", description: "Daily clicks, impressions and organic sessions, last 28 days.", default: true, needs: "google", source: "Search Console · GA4" },
      { id: "queries", label: "Top search queries", description: "Queries that bring the most clicks.", default: true, needs: "google", source: "Search Console" },
      { id: "pages", label: "Top landing pages", description: "Pages by clicks and organic sessions.", needs: "google", source: "Search Console · GA4" },
      { id: "audit", label: "Site Audit", description: "Site Health trend, errors and warnings from your crawls.", default: true, source: "Site Audit crawls" },
      { id: "rankings", label: "Tracked keyword rankings", description: "Latest positions of your tracked keywords.", default: true, source: "Position Tracking" },
      { id: "competitors", label: "Competitor benchmark", description: "Your project's competitors side by side.", needs: "dataforseo", source: "DataForSEO" },
      { id: "backlinks", label: "Backlink profile", description: "Referring domains and top referring domains.", needs: "dataforseo", source: "DataForSEO" },
      { id: "activity", label: "Recent activity", description: "Latest background jobs for the project.", source: "Your jobs" },
    ],
  },
  {
    id: "backlinks",
    name: "Backlink report",
    short: "Backlinks",
    description: "Referring domains growth, new and lost links, anchors, link attributes and toxicity.",
    subject: "domain",
    needs: "dataforseo",
    sections: [
      { id: "summary", label: "Backlink summary", description: "Backlinks, referring domains, IPs and follow ratio.", default: true },
      { id: "growth", label: "Referring domains growth", description: "Referring domains and backlinks over 24 months.", default: true },
      { id: "velocity", label: "New & lost referring domains", description: "Daily link velocity for the last 90 days.", default: true },
      { id: "referring", label: "Top referring domains", description: "Strongest domains linking to the site.", default: true },
      { id: "anchors", label: "Top anchors", description: "Most used anchor texts.", default: true },
      { id: "types", label: "Link attributes & types", description: "Follow vs nofollow and link types." },
      { id: "toxicity", label: "Toxicity overview", description: "Share of potentially toxic referring domains." },
    ],
  },
  {
    id: "comparison",
    name: "Competitor comparison",
    short: "Comparison",
    description: "Benchmark a domain against up to four competitors: traffic, keywords, backlinks and authority.",
    subject: "domain",
    competitors: true,
    needs: "dataforseo",
    sections: [
      { id: "summary", label: "Side-by-side metrics", description: "Headline metrics for every domain.", default: true },
      { id: "traffic", label: "Organic traffic trend", description: "Monthly organic traffic of all domains.", default: true },
      { id: "keywords", label: "Organic keywords", description: "Keyword counts and top-10 keywords.", default: true },
      { id: "backlinks", label: "Referring domains", description: "Referring domains and backlinks.", default: true },
      { id: "positioning", label: "Competitive positioning map", description: "Keywords vs traffic bubble chart.", default: true },
      { id: "authority", label: "Authority Score", description: "Authority Score trend over 12 months." },
    ],
  },
];

export const templateById = (id: string | null | undefined) => TEMPLATES.find((t) => t.id === id) ?? null;

/** Which providers are available (true) — with DEMO_DATA=true every section is available. */
export type Availability = { dataforseo: boolean; google: boolean; demo: boolean };
/** Sections without a real source (toxicity is a demo-engine estimate) are available only in demo mode. */
const DEMO_ONLY = new Set(["backlinks:toxicity", "domain:intents", "domain:countries", "comparison:authority"]);
export const sectionAvailable = (t: TemplateDef, s: SectionDef, a: Availability) =>
  a.demo || (!DEMO_ONLY.has(`${t.id}:${s.id}`) && (!t.needs || a[t.needs]) && (!s.needs || a[s.needs]));
export const templateAvailable = (t: TemplateDef, a: Availability) => a.demo || !t.needs || a[t.needs];
/** Sections a template shows in the builder (demo-only sections are hidden outside demo mode). */
export const visibleSections = (t: TemplateDef, a: Availability) => t.sections.filter((s) => a.demo || !DEMO_ONLY.has(`${t.id}:${s.id}`));
export const defaultSections = (t: TemplateDef, a?: Availability) => t.sections.filter((s) => s.default && (!a || sectionAvailable(t, s, a))).map((s) => s.id);

/** Fixed accent palette for report branding (applied to the cover and section rules). */
export const ACCENTS = [
  { id: "indigo", label: "Indigo", color: "#5b45e8" },
  { id: "blue", label: "Blue", color: "#1d64d8" },
  { id: "teal", label: "Teal", color: "#0e8a80" },
  { id: "green", label: "Green", color: "#16803c" },
  { id: "orange", label: "Orange", color: "#d4561f" },
  { id: "rose", label: "Rose", color: "#c02a5c" },
  { id: "slate", label: "Slate", color: "#344054" },
] as const;
export type AccentId = (typeof ACCENTS)[number]["id"];
export const accentColor = (id: string | null | undefined) => (ACCENTS.find((a) => a.id === id) ?? ACCENTS[0]).color;

export type Branding = { company: string; preparedFor: string; accent: AccentId; intro: string };

/** Saved report as sent to client components. */
export type ReportRecord = {
  id: string;
  template: TemplateId;
  title: string;
  subject: string;
  db: string;
  project_id: string | null;
  project_name: string | null;
  options: { competitors?: string[] };
  sections: string[];
  branding: Branding;
  created_at: string;
  updated_at: string;
};
