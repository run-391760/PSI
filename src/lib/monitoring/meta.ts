/** Client-safe brand monitoring types and labels. */
import type { Sentiment } from "./sentiment";

export type BrandSettings = { competitorTerms: string[]; demoSocial: boolean; createdAt: string; lastRunAt: string | null; lastError: string | null };
export type MentionStatus = "new" | "reviewed" | "archived";
export type Mention = {
  id: string;
  subject: string;
  term: string;
  source: "google-news" | "demo";
  channel: string;
  publisher: string;
  publisherDomain: string | null;
  title: string;
  snippet: string;
  url: string;
  publishedAt: string;
  sentiment: Sentiment;
  sentimentScore: number;
  reach: number;
  status: MentionStatus;
  tags: string[];
};

export const CHANNELS: Record<string, string> = {
  news: "News",
  reddit: "Reddit",
  x: "X (Twitter)",
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  quora: "Quora",
  forum: "Forums",
  blog: "Blogs",
};

