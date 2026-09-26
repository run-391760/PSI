/** Client-safe provenance types and labels (no server imports). */
export type DataSource =
  | "demo"
  | "dataforseo"
  | "crawler"
  | "google-autocomplete"
  | "pagespeed"
  | "google-news"
  | "anthropic"
  | "openai"
  | "gemini"
  | "perplexity"
  | "search-console"
  | "google-analytics"
  | "user";

export type Sourced<T> = {
  data: T;
  source: DataSource;
  /** ISO timestamp of when the data was produced/fetched. */
  fetchedAt: string;
  /** True when the numbers come from a real measurement or index (not the demo engine). */
  live: boolean;
  note?: string;
};

export const SOURCE_LABELS: Record<DataSource, string> = {
  demo: "Demo data",
  dataforseo: "DataForSEO",
  crawler: "Live crawl",
  "google-autocomplete": "Google Autocomplete",
  pagespeed: "PageSpeed Insights",
  "google-news": "Google News",
  anthropic: "Claude",
  openai: "ChatGPT (OpenAI)",
  gemini: "Gemini",
  perplexity: "Perplexity",
  "search-console": "Search Console",
  "google-analytics": "Google Analytics",
  user: "Your data",
};
