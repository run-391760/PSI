/** Client-safe SERP Sensor constants: volatility bands and the reference list of Google updates. */

export type BandTone = "good" | "info" | "warning" | "critical";
export const BANDS: { id: string; label: string; min: number; max: number; tone: BandTone; color: string; note: string }[] = [
  { id: "low", label: "Low", min: 0, max: 2, tone: "good", color: "var(--good)", note: "SERPs are calm; rankings barely moved." },
  { id: "normal", label: "Normal", min: 2, max: 5, tone: "info", color: "var(--link)", note: "Typical day-to-day fluctuation." },
  { id: "high", label: "High", min: 5, max: 8, tone: "warning", color: "var(--warning)", note: "Noticeable reshuffling. Check your rankings." },
  { id: "very-high", label: "Very high", min: 8, max: 10, tone: "critical", color: "var(--critical)", note: "Heavy turbulence, typical of a Google update rollout." },
];
export const bandFor = (score: number) => BANDS.find((b) => score < b.max) ?? BANDS[BANDS.length - 1];

/**
 * Curated reference list of confirmed Google ranking updates (start/end as announced on the Google
 * Search Status Dashboard). Shown as chart markers labelled "reference"; not exhaustive.
 */
export const GOOGLE_UPDATES: { start: string; end: string; name: string; type: "core" | "spam" }[] = [
  { start: "2024-03-05", end: "2024-04-19", name: "March 2024 core update", type: "core" },
  { start: "2024-03-05", end: "2024-03-20", name: "March 2024 spam update", type: "spam" },
  { start: "2024-06-20", end: "2024-06-27", name: "June 2024 spam update", type: "spam" },
  { start: "2024-08-15", end: "2024-09-03", name: "August 2024 core update", type: "core" },
  { start: "2024-11-11", end: "2024-12-05", name: "November 2024 core update", type: "core" },
  { start: "2024-12-12", end: "2024-12-18", name: "December 2024 core update", type: "core" },
  { start: "2024-12-19", end: "2024-12-26", name: "December 2024 spam update", type: "spam" },
  { start: "2025-03-13", end: "2025-03-27", name: "March 2025 core update", type: "core" },
  { start: "2025-06-30", end: "2025-07-17", name: "June 2025 core update", type: "core" },
  { start: "2025-08-26", end: "2025-09-22", name: "August 2025 spam update", type: "spam" },
];
export const UPDATES_NOTE = "Reference list of confirmed Google updates through September 2025. Newer updates are not included.";

