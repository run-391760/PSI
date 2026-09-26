/** Position change types shared by server pages and client tables (plain module, no "use client"). */
export type ChangeKind = "improved" | "declined" | "new" | "lost";

export const CHANGE_META: Record<ChangeKind, { label: string; color: string; note: string }> = {
  improved: { label: "Improved", color: "var(--series-3)", note: "Keywords that moved up" },
  declined: { label: "Declined", color: "var(--series-2)", note: "Keywords that moved down" },
  new: { label: "New", color: "var(--series-1)", note: "Keywords that entered the rankings" },
  lost: { label: "Lost", color: "var(--series-8)", note: "Keywords that dropped out of the rankings" },
};
export const CHANGE_ORDER: ChangeKind[] = ["improved", "declined", "new", "lost"];
