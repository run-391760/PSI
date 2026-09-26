/** Client-safe AI Visibility constants and types. */
import type { Sentiment } from "@/lib/monitoring/sentiment";

export const ENGINES = [
  { id: "chatgpt", name: "ChatGPT", short: "GPT", mention: 1.0, cite: 0.55, presence: 1 },
  { id: "gemini", name: "Gemini", short: "GEM", mention: 0.95, cite: 0.62, presence: 1 },
  { id: "perplexity", name: "Perplexity", short: "PPX", mention: 1.05, cite: 1.0, presence: 1 },
  { id: "google-aio", name: "Google AI Overviews", short: "AIO", mention: 0.86, cite: 0.92, presence: 0.62 },
  { id: "claude", name: "Claude", short: "CLD", mention: 0.93, cite: 0.5, presence: 1 },
] as const;
export type EngineId = (typeof ENGINES)[number]["id"];
export const engineName = (id: string) => ENGINES.find((e) => e.id === id)?.name ?? id;

export type AnswerResult = {
  engine: EngineId;
  day: string;
  /** False when the engine showed no AI answer (e.g. no AI Overview for the query). */
  present: boolean;
  mentioned: boolean;
  position: number | null;
  cited: boolean;
  citedUrl: string | null;
  competitors: string[];
  /** Brands in the order the answer lists them (yours included when mentioned). */
  brands: string[];
  sentiment: Sentiment | null;
  /** Domains cited as sources in the answer. */
  sources: string[];
};

export type PromptRow = { id: string; prompt: string; source: "suggested" | "custom"; createdAt: string };

export type AiBot = { agent: string; owner: string; purpose: string; kind: "training" | "search" | "user" };
export const AI_BOTS: AiBot[] = [
  { agent: "GPTBot", owner: "OpenAI", purpose: "Collects content to train OpenAI models", kind: "training" },
  { agent: "OAI-SearchBot", owner: "OpenAI", purpose: "Indexes pages for ChatGPT search answers", kind: "search" },
  { agent: "ChatGPT-User", owner: "OpenAI", purpose: "Fetches pages when a ChatGPT user asks", kind: "user" },
  { agent: "ClaudeBot", owner: "Anthropic", purpose: "Collects content to train Claude models", kind: "training" },
  { agent: "Claude-SearchBot", owner: "Anthropic", purpose: "Indexes pages for Claude's search answers", kind: "search" },
  { agent: "PerplexityBot", owner: "Perplexity", purpose: "Indexes pages for Perplexity answers", kind: "search" },
  { agent: "Google-Extended", owner: "Google", purpose: "Controls use of content for Gemini training and grounding", kind: "training" },
  { agent: "Applebot-Extended", owner: "Apple", purpose: "Controls use of content for Apple Intelligence training", kind: "training" },
  { agent: "CCBot", owner: "Common Crawl", purpose: "Open web crawl used to train many LLMs", kind: "training" },
];

export type BotAccess = { agent: string; status: "allowed" | "partial" | "blocked" | "unknown"; rule: "explicit" | "wildcard" | "none"; disallowed: string[] };
export type ReadinessResult = {
  domain: string;
  checkedUrl: string;
  robots: { status: number | null; found: boolean; error: string | null; sitemaps: string[]; bytes: number };
  bots: BotAccess[];
  llms: { found: boolean; status: number | null; title: string | null; links: number; sections: number; bytes: number; error: string | null };
  llmsFull: { found: boolean; status: number | null; bytes: number };
  homepage: { status: number | null; words: number; noai: boolean; structured: string[]; title: string; error: string | null };
};

export type LiveResult = {
  id: string;
  prompt: string;
  /** Live engine id: chatgpt | gemini | perplexity | google-aio | claude. */
  engine: string;
  model: string;
  createdAt: string;
  mentioned: boolean;
  cited: boolean;
  position: number | null;
  citedUrls: string[];
  competitors: string[];
  sources: string[];
  sentiment: Sentiment | null;
  answer: string;
  error: string | null;
};
