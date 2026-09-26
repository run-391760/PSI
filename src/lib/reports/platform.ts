import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { getProject, type Project } from "@/lib/projects";
import type { ToolSummary } from "@/lib/projects/summary-types";
import { flagEnabled, liveEnabled } from "@/lib/providers/source";
import type { Cadence } from "@/lib/jobs/types";
import type { JobListRow } from "./kinds";

/**
 * Platform-wide queries for Home, Projects, Activity and Settings (server-only).
 */

/** Timestamps come back as Date (PGlite) or string (pg); normalize to ISO strings for client props. */
export function iso<T extends string | Date | null | undefined>(v: T): T extends null | undefined ? null : string {
  if (v == null) return null as never;
  return (v instanceof Date ? v.toISOString() : new Date(v).toISOString()) as never;
}

// ------------------------------------------------------------------------------------------ jobs

export type JobFilters = { status?: string | null; module?: string | null; projectId?: string | null; limit?: number };

export async function listJobRows(ownerId: string, f: JobFilters = {}) {
  const rows = await query<JobListRow>(
    `SELECT j.id, j.kind, j.status, j.progress, j.total, j.message, j.error, j.attempts, j.created_at, j.started_at, j.finished_at,
            j.project_id, p.name AS project_name, p.domain AS project_domain
       FROM jobs j LEFT JOIN projects p ON p.id=j.project_id
      WHERE j.owner_id=$1
        AND ($2::text IS NULL OR j.status=$2)
        AND ($3::text IS NULL OR j.kind LIKE ($3::text || '.%'))
        AND ($4::text IS NULL OR j.project_id=$4)
      ORDER BY j.created_at DESC LIMIT $5`,
    [ownerId, f.status || null, f.module || null, f.projectId || null, f.limit ?? 100],
  );
  return rows.map((r) => ({ ...r, created_at: iso(r.created_at), started_at: iso(r.started_at), finished_at: iso(r.finished_at) }));
}

export async function jobCounts(ownerId: string) {
  const [row] = await query<{ queued: number; running: number; failed24h: number; done24h: number; total: number }>(
    `SELECT count(*) FILTER (WHERE status='queued')::int AS queued,
            count(*) FILTER (WHERE status='running')::int AS running,
            count(*) FILTER (WHERE status='failed' AND created_at > now() - interval '1 day')::int AS failed24h,
            count(*) FILTER (WHERE status='done' AND created_at > now() - interval '1 day')::int AS done24h,
            count(*)::int AS total
       FROM jobs WHERE owner_id=$1`,
    [ownerId],
  );
  return row;
}

/** Distinct job module prefixes the user has jobs for (activity filter options). */
export async function jobModules(ownerId: string) {
  const rows = await query<{ module: string }>("SELECT DISTINCT split_part(kind,'.',1) AS module FROM jobs WHERE owner_id=$1 ORDER BY 1", [ownerId]);
  return rows.map((r) => r.module);
}

// ------------------------------------------------------------------------------------- schedules

export type ScheduleRow = {
  project_id: string;
  kind: string;
  cadence: Cadence;
  enabled: boolean;
  payload: Record<string, unknown>;
  last_run_at: string | null;
  next_run_at: string;
};

export async function projectSchedules(ownerId: string, projectId: string) {
  await getProject(ownerId, projectId);
  const rows = await query<ScheduleRow>("SELECT project_id,kind,cadence,enabled,payload,last_run_at,next_run_at FROM schedules WHERE project_id=$1 ORDER BY kind", [projectId]);
  return rows.map((r) => ({ ...r, last_run_at: iso(r.last_run_at), next_run_at: iso(r.next_run_at) }));
}

export async function scheduleCounts(ownerId: string) {
  const [row] = await query<{ enabled: number; total: number }>(
    "SELECT count(*) FILTER (WHERE s.enabled)::int AS enabled, count(*)::int AS total FROM schedules s JOIN projects p ON p.id=s.project_id WHERE p.owner_id=$1",
    [ownerId],
  );
  return row;
}

/** Update cadence/enabled of an existing schedule without touching its payload. */
export async function updateSchedule(ownerId: string, projectId: string, kind: string, patch: { enabled?: boolean; cadence?: Cadence; runNow?: boolean }) {
  await getProject(ownerId, projectId);
  const rows = await query(
    `UPDATE schedules SET enabled=COALESCE($3, enabled), cadence=COALESCE($4, cadence),
            next_run_at=CASE WHEN $5 THEN now() ELSE next_run_at END
      WHERE project_id=$1 AND kind=$2 RETURNING kind`,
    [projectId, kind, patch.enabled ?? null, patch.cadence ?? null, patch.runNow ?? false],
  );
  if (!rows.length) throw new AppError("Schedule not found.", 404);
}

// ------------------------------------------------------------------------------------ onboarding

export type OnboardingStep = { id: string; label: string; description: string; done: boolean; href?: string; cta: string };

/**
 * First-run checklist computed from real account state: projects, jobs, schedules, tool widgets and
 * provider configuration. `summaries` are the widgets of the user's projects (already loaded by Home).
 */
export async function onboardingSteps(ownerId: string, projects: Project[], summaries: ToolSummary[][]): Promise<OnboardingStep[]> {
  const [activity] = await query<{ audit: number; tracking: number }>(
    `SELECT
       (SELECT count(*) FROM jobs WHERE owner_id=$1 AND kind LIKE 'site-audit.%' AND status IN ('done','running','queued'))::int AS audit,
       ((SELECT count(*) FROM jobs WHERE owner_id=$1 AND kind LIKE 'position-tracking.%')
        + (SELECT count(*) FROM schedules s JOIN projects p ON p.id=s.project_id WHERE p.owner_id=$1 AND s.kind LIKE 'position-tracking.%'))::int AS tracking`,
    [ownerId],
  );
  const widget = (tool: string) => summaries.flat().some((s) => s.tool === tool && s.state !== "empty" && s.state !== "error");
  const first = projects[0];
  const withProject = (path: string) => (first ? `${path}?project=${first.id}` : path);
  return [
    { id: "project", label: "Create your first project", description: "A project groups the tools that monitor one website.", done: projects.length > 0, cta: "Create project" },
    { id: "audit", label: "Run a Site Audit", description: "Crawl your site and find technical SEO issues.", done: activity.audit > 0 || widget("site-audit"), href: withProject("/site-audit"), cta: "Start audit" },
    { id: "tracking", label: "Set up Position Tracking", description: "Track daily Google rankings for your target keywords.", done: activity.tracking > 0 || widget("position-tracking"), href: withProject("/position-tracking"), cta: "Track keywords" },
    { id: "competitors", label: "Add competitors", description: "Benchmark your visibility and backlinks against rivals.", done: projects.some((p) => p.competitors.length > 0), href: first ? `/projects/${first.id}?tab=settings` : "/projects", cta: "Add competitors" },
    { id: "live", label: "Connect live data", description: "Add DataForSEO credentials to replace demo data with live index data.", done: liveEnabled(), href: "/settings?tab=integrations", cta: "Connect" },
  ];
}

// ---------------------------------------------------------------------------------- preferences

export async function getPrefs(userId: string) {
  const [row] = await query<{ prefs: Record<string, unknown> }>("SELECT prefs FROM platform_prefs WHERE user_id=$1", [userId]);
  return row?.prefs ?? {};
}
export async function setPrefs(userId: string, patch: Record<string, unknown>) {
  await query(
    `INSERT INTO platform_prefs(user_id,prefs,updated_at) VALUES($1,$2::jsonb,now())
     ON CONFLICT(user_id) DO UPDATE SET prefs=platform_prefs.prefs || excluded.prefs, updated_at=now()`,
    [userId, JSON.stringify(patch)],
  );
}

// ---------------------------------------------------------------------------------- integrations

export type Integration = {
  id: string;
  name: string;
  description: string;
  status: "connected" | "enabled" | "disabled" | "not-configured";
  statusLabel: string;
  powers: string[];
  envVars: { name: string; set: boolean; example: string; required: boolean }[];
  docs?: string;
  note?: string;
};

const isSet = (name: string) => Boolean(process.env[name] && process.env[name]!.trim());

/** Provider status from environment variables. Never returns secret values, only whether they are set. */
export function integrations(): Integration[] {
  const dfs = liveEnabled();
  const autocomplete = flagEnabled("ENABLE_AUTOCOMPLETE");
  const pagespeed = flagEnabled("ENABLE_PAGESPEED");
  const news = flagEnabled("ENABLE_NEWS_MENTIONS");
  const anthropic = isSet("ANTHROPIC_API_KEY");
  const googleSa = isSet("GOOGLE_SERVICE_ACCOUNT_JSON") || isSet("GOOGLE_SERVICE_ACCOUNT_FILE");
  const google = (isSet("GOOGLE_CLIENT_ID") && isSet("GOOGLE_CLIENT_SECRET")) || googleSa;
  return [
    {
      id: "dataforseo",
      name: "DataForSEO",
      description: "Paid, pay-as-you-go index data: keyword metrics, live SERPs, domain analytics and backlinks.",
      status: dfs ? "connected" : "not-configured",
      statusLabel: dfs ? "Connected" : "Not configured — demo data in use",
      powers: ["Keyword Overview & Magic Tool", "Domain Overview & Organic Research", "Position Tracking", "Backlink Analytics", "Google AI Overviews in AI Visibility"],
      envVars: [
        { name: "DATAFORSEO_LOGIN", set: isSet("DATAFORSEO_LOGIN"), example: "you@example.com", required: true },
        { name: "DATAFORSEO_PASSWORD", set: isSet("DATAFORSEO_PASSWORD"), example: "your-api-password", required: true },
      ],
      docs: "https://dataforseo.com/apis",
      note: "Every paid call reserves its worst-case cost against your monthly budget first.",
    },
    {
      id: "autocomplete",
      name: "Google Autocomplete",
      description: "Free real query suggestions for keyword ideas and questions.",
      status: autocomplete ? "enabled" : "disabled",
      statusLabel: autocomplete ? "Enabled" : "Disabled",
      powers: ["Keyword Magic Tool suggestions", "Topic Research questions"],
      envVars: [{ name: "ENABLE_AUTOCOMPLETE", set: isSet("ENABLE_AUTOCOMPLETE"), example: "true", required: false }],
    },
    {
      id: "pagespeed",
      name: "PageSpeed Insights",
      description: "Free Core Web Vitals and Lighthouse lab data from Google.",
      status: pagespeed ? "enabled" : "disabled",
      statusLabel: pagespeed ? (isSet("PAGESPEED_API_KEY") ? "Enabled · API key set" : "Enabled · shared quota") : "Disabled",
      powers: ["Site Audit performance checks", "On Page SEO Checker"],
      envVars: [
        { name: "ENABLE_PAGESPEED", set: isSet("ENABLE_PAGESPEED"), example: "true", required: false },
        { name: "PAGESPEED_API_KEY", set: isSet("PAGESPEED_API_KEY"), example: "AIza…", required: false },
      ],
      docs: "https://developers.google.com/speed/docs/insights/v5/get-started",
      note: "An API key is optional but raises the request quota.",
    },
    {
      id: "news",
      name: "Google News",
      description: "Free public news RSS used to find brand mentions.",
      status: news ? "enabled" : "disabled",
      statusLabel: news ? "Enabled" : "Disabled",
      powers: ["Brand Monitoring mentions"],
      envVars: [{ name: "ENABLE_NEWS_MENTIONS", set: isSet("ENABLE_NEWS_MENTIONS"), example: "true", required: false }],
    },
    {
      id: "google",
      name: "Google Search Console & Analytics",
      description: "Your own sites' real clicks, impressions, queries, positions, organic sessions and key events (OAuth, read-only).",
      status: google ? "enabled" : "not-configured",
      statusLabel: googleSa ? "Service account configured" : google ? "Configured · each user connects their Google account" : "Not configured",
      powers: ["Organic Traffic Insights", "Project dashboard widget", "Queries → Position Tracking"],
      envVars: [
        { name: "GOOGLE_SERVICE_ACCOUNT_JSON", set: googleSa, example: "base64 of the key JSON", required: false },
        { name: "GOOGLE_CLIENT_ID", set: isSet("GOOGLE_CLIENT_ID"), example: "…apps.googleusercontent.com", required: false },
        { name: "GOOGLE_CLIENT_SECRET", set: isSet("GOOGLE_CLIENT_SECRET"), example: "GOCSPX-…", required: false },
        { name: "APP_SECRET", set: isSet("APP_SECRET"), example: "long random string", required: process.env.NODE_ENV === "production" },
      ],
      docs: "https://console.cloud.google.com/apis/credentials",
      note: "Enable the Search Console API, Analytics Data API and Analytics Admin API. Redirect URI: <APP_ORIGIN>/api/integrations/google/callback. Connect your account on Organic Traffic Insights.",
    },
    {
      id: "openai",
      name: "OpenAI (ChatGPT)",
      description: "Real AI-answer checks with web search: does ChatGPT mention or cite your brand?",
      status: isSet("OPENAI_API_KEY") ? "connected" : "not-configured",
      statusLabel: isSet("OPENAI_API_KEY") ? `Connected · ${process.env.OPENAI_MODEL || "gpt-6-astra"}` : "Not configured",
      powers: ["AI Visibility live answers"],
      envVars: [
        { name: "OPENAI_API_KEY", set: isSet("OPENAI_API_KEY"), example: "sk-…", required: true },
        { name: "OPENAI_MODEL", set: isSet("OPENAI_MODEL"), example: "gpt-6-astra", required: false },
      ],
      docs: "https://platform.openai.com/api-keys",
    },
    {
      id: "gemini",
      name: "Google Gemini",
      description: "Real AI-answer checks grounded with Google Search.",
      status: isSet("GEMINI_API_KEY") ? "connected" : "not-configured",
      statusLabel: isSet("GEMINI_API_KEY") ? `Connected · ${process.env.GEMINI_MODEL || "gemini-3.8-flash"}` : "Not configured",
      powers: ["AI Visibility live answers"],
      envVars: [
        { name: "GEMINI_API_KEY", set: isSet("GEMINI_API_KEY"), example: "AIza…", required: true },
        { name: "GEMINI_MODEL", set: isSet("GEMINI_MODEL"), example: "gemini-3.8-flash", required: false },
      ],
      docs: "https://aistudio.google.com/apikey",
    },
    {
      id: "perplexity",
      name: "Perplexity",
      description: "Real AI-answer checks from the Perplexity Agent API with web search.",
      status: isSet("PERPLEXITY_API_KEY") ? "connected" : "not-configured",
      statusLabel: isSet("PERPLEXITY_API_KEY") ? `Connected · ${process.env.PERPLEXITY_MODEL || `preset ${process.env.PERPLEXITY_PRESET || "low"}`}` : "Not configured",
      powers: ["AI Visibility live answers"],
      envVars: [
        { name: "PERPLEXITY_API_KEY", set: isSet("PERPLEXITY_API_KEY"), example: "pplx-…", required: true },
        { name: "PERPLEXITY_PRESET", set: isSet("PERPLEXITY_PRESET"), example: "low", required: false },
      ],
      docs: "https://docs.perplexity.ai/",
    },
    {
      id: "anthropic",
      name: "Anthropic (Claude)",
      description: "Real AI-answer checks with web search: does Claude mention or cite your brand?",
      status: anthropic ? "connected" : "not-configured",
      statusLabel: anthropic ? "Connected" : "Not configured",
      powers: ["AI Visibility live answers"],
      envVars: [{ name: "ANTHROPIC_API_KEY", set: anthropic, example: "sk-ant-…", required: true }],
      docs: "https://console.anthropic.com/",
    },
  ];
}

export function systemInfo() {
  return {
    database: process.env.DATABASE_URL ? "PostgreSQL (DATABASE_URL)" : "Embedded PGlite (.data/postgres)",
    worker: process.env.LOCAL_WORKER === "false" ? "Disabled (LOCAL_WORKER=false)" : `In-process · concurrency ${Number(process.env.WORKER_CONCURRENCY || 3)}`,
    signups: process.env.ALLOW_SIGNUPS === "true" ? "Open" : process.env.SIGNUP_INVITE_CODE ? "Invite code required" : process.env.NODE_ENV === "production" ? "Closed" : "Open (development)",
  };
}

// ---------------------------------------------------------------------------------------- usage

export const maxMonthlyUsd = () => Number(process.env.MAX_MONTHLY_API_USD || 50);
export const globalBudgetUsd = () => Number(process.env.GLOBAL_API_BUDGET_USD || 50);

export type UsageEvent = { id: string; endpoint: string; reserved_micros: string; actual_micros: string | null; status: string; created_at: string };

export async function usageEvents(ownerId: string, limit = 500) {
  const rows = await query<UsageEvent>("SELECT id,endpoint,reserved_micros,actual_micros,status,created_at FROM usage_events WHERE owner_id=$1 ORDER BY created_at DESC LIMIT $2", [ownerId, limit]);
  return rows.map((r) => ({ ...r, reserved_micros: String(r.reserved_micros), actual_micros: r.actual_micros == null ? null : String(r.actual_micros), created_at: iso(r.created_at) }));
}

/** Daily reserved/actual spend for the current month (USD). */
export async function dailySpend(ownerId: string) {
  const rows = await query<{ day: string; reserved: string; actual: string; calls: number }>(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, sum(reserved_micros)::text AS reserved,
            sum(COALESCE(actual_micros,0))::text AS actual, count(*)::int AS calls
       FROM usage_events WHERE owner_id=$1 AND created_at >= date_trunc('month', now()) GROUP BY 1 ORDER BY 1`,
    [ownerId],
  );
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const now = new Date();
  const days: { day: string; reserved: number; actual: number; calls: number }[] = [];
  for (let d = 1; d <= now.getUTCDate(); d++) {
    const key = `${now.toISOString().slice(0, 7)}-${String(d).padStart(2, "0")}`;
    const r = byDay.get(key);
    days.push({ day: key, reserved: r ? Number(r.reserved) / 1e6 : 0, actual: r ? Number(r.actual) / 1e6 : 0, calls: r?.calls ?? 0 });
  }
  return days;
}

export async function spendByEndpoint(ownerId: string) {
  const rows = await query<{ endpoint: string; calls: number; reserved: string; actual: string }>(
    `SELECT endpoint, count(*)::int AS calls, sum(reserved_micros)::text AS reserved, sum(COALESCE(actual_micros,0))::text AS actual
       FROM usage_events WHERE owner_id=$1 AND created_at >= date_trunc('month', now()) GROUP BY endpoint ORDER BY sum(reserved_micros) DESC LIMIT 12`,
    [ownerId],
  );
  return rows.map((r) => ({ endpoint: r.endpoint, calls: r.calls, reserved: Number(r.reserved) / 1e6, actual: Number(r.actual) / 1e6 }));
}

export async function accountSpend() {
  const [row] = await query<{ reserved_micros: string }>("SELECT reserved_micros FROM account_usage WHERE month=$1", [new Date().toISOString().slice(0, 7)]);
  return Number(row?.reserved_micros || 0) / 1e6;
}

export async function cacheStats() {
  return query<{ source: string; entries: number; fresh: number }>(
    "SELECT source, count(*)::int AS entries, count(*) FILTER (WHERE expires_at > now())::int AS fresh FROM provider_cache GROUP BY source ORDER BY 2 DESC",
  );
}
