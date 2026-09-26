import type { Project } from "./index";

/** One widget on the project dashboard. Each project-based tool provides its own. */
export type ToolSummary = {
  tool: string;
  label: string;
  /** Where the widget links (include ?project=<id>). */
  href: string;
  state: "empty" | "running" | "ready" | "error";
  /**
   * `delta` is the signed change behind the headline, expressed in `deltaUnit` (default "percent":
   * relative change vs the previous period; "points": percentage-point change, e.g. visibility or
   * health score; "absolute": change in the headline's own unit, e.g. +12 ideas).
   */
  headline?: { label: string; value: string; delta?: number | null; deltaUnit?: "percent" | "points" | "absolute"; upIsGood?: boolean };
  stats?: { label: string; value: string }[];
  /** Small trend series for a sparkline (oldest first). */
  spark?: number[];
  updatedAt?: string;
  /** Call to action when state is "empty" (e.g. "Set up"). */
  cta?: string;
  note?: string;
};
export type SummaryProvider = (project: Project) => Promise<ToolSummary>;
