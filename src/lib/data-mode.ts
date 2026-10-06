import { query } from "@/lib/db";
import { anthropicEnabled } from "@/lib/providers/anthropic";
import { llmConfigured } from "@/lib/providers/llm";
import { pagespeedEnabled } from "@/lib/providers/pagespeed";
import { liveEnabled } from "@/lib/providers/source";
import { googleConfigured } from "@/lib/google/oauth";
import { getProjectGoogle, type ProjectGoogleLink } from "@/lib/google/data";
import type { Project } from "@/lib/projects";

/**
 * Real-data policy. Synthetic numbers from the demo engine (src/lib/seo/engine) are shown ONLY when
 * DEMO_DATA=true (local development). Otherwise every report uses a configured real source or shows a
 * <NeedsData> card naming the API it needs. Never fall back to demo numbers silently.
 */
export const demoAllowed = () => process.env.DEMO_DATA === "true";

/** `ai` = any AI-visibility engine; `llm` = a model key for writing features (optimizer, CX AI). */
export type Provider = "dataforseo" | "google" | "pagespeed" | "ai" | "llm" | "business-profile" | "clickstream";

export const PROVIDER_INFO: Record<Provider, { name: string; env: string[]; description: string; href: string }> = {
  dataforseo: {
    name: "DataForSEO",
    env: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"],
    description: "Web-scale keyword volumes, difficulty, live Google SERPs, competitor rankings and backlink index.",
    href: "/settings?tab=integrations",
  },
  google: {
    name: "Google Search Console + GA4",
    // Any one is enough: a service account (JSON or file) or an OAuth web client (both vars).
    env: [
      "GOOGLE_SERVICE_ACCOUNT_JSON",
      "GOOGLE_SERVICE_ACCOUNT_FILE",
      "GOOGLE_GA4_SERVICE_ACCOUNT_JSON",
      "GOOGLE_GA4_SERVICE_ACCOUNT_FILE",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
    ],
    description: "Real clicks, impressions, positions and queries (Search Console) and sessions, channels and conversions (GA4) for your own sites.",
    href: "/organic-traffic-insights",
  },
  pagespeed: {
    name: "PageSpeed Insights",
    env: ["ENABLE_PAGESPEED", "PAGESPEED_API_KEY"],
    description: "Core Web Vitals and Lighthouse performance data from Google (free; on unless ENABLE_PAGESPEED=false, an API key only raises the quota).",
    href: "/settings?tab=integrations",
  },
  ai: {
    name: "An AI engine API key",
    env: ["OPENAI_API_KEY", "GEMINI_API_KEY", "PERPLEXITY_API_KEY", "ANTHROPIC_API_KEY"],
    description: "Real answers from ChatGPT, Gemini, Perplexity or Claude with web search.",
    href: "/settings?tab=integrations",
  },
  llm: {
    name: "An AI model API key",
    env: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"],
    description: "AI review, rewrites, briefs, suggested replies and insights from Claude, OpenAI or Gemini.",
    href: "/settings?tab=integrations",
  },
  "business-profile": {
    name: "Google Business Profile API (or a listings partner such as Yext/BrightLocal)",
    env: [],
    description: "Business listings, local pack rankings and reviews. Requires Google approval or a partner account.",
    href: "/settings?tab=integrations",
  },
  clickstream: {
    name: "A clickstream provider (Similarweb or Semrush API)",
    env: [],
    description: "Visits, traffic channels and audience for websites you don't own. For your own sites, GA4 is used instead.",
    href: "/settings?tab=integrations",
  },
};

export function providerStatus(): Record<Provider, boolean> {
  return {
    dataforseo: liveEnabled(),
    google: googleConfigured(),
    pagespeed: pagespeedEnabled(),
    ai: ["OPENAI_API_KEY", "GEMINI_API_KEY", "PERPLEXITY_API_KEY"].some((k) => !!process.env[k]) || anthropicEnabled(),
    llm: llmConfigured(),
    "business-profile": false,
    clickstream: false,
  };
}

/** One of the user's projects for this domain that is linked to Search Console and/or GA4. */
export async function googleProjectForDomain(
  userId: string,
  domain: string,
): Promise<{ project: Pick<Project, "id" | "name" | "domain" | "country">; link: ProjectGoogleLink } | null> {
  if (!googleConfigured()) return null;
  const rows = await query<{ id: string; name: string; domain: string; country: string }>(
    "SELECT id,name,domain,country FROM projects WHERE owner_id=$1 AND domain=$2 LIMIT 1",
    [userId, domain],
  );
  if (!rows[0]) return null;
  const link = await getProjectGoogle(rows[0].id);
  return link.gscSite || link.ga4Property ? { project: rows[0], link } : null;
}
