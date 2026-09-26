/** Client-safe listing types and labels. */
import type { Directory } from "./directories";

export type FieldKey = "name" | "address" | "phone" | "website" | "hours" | "categories";
export const NAP_FIELDS: FieldKey[] = ["name", "address", "phone", "website"];
export const FIELD_LABELS: Record<FieldKey, string> = { name: "Name", address: "Address", phone: "Phone", website: "Website", hours: "Hours", categories: "Categories" };

export type ListingStatus = "synced" | "needs_update" | "not_listed" | "duplicates" | "in_review";
export const STATUS_META: Record<ListingStatus, { label: string; tone: "good" | "warning" | "critical" | "serious" | "info" }> = {
  synced: { label: "Synced", tone: "good" },
  needs_update: { label: "Needs update", tone: "warning" },
  not_listed: { label: "Not listed", tone: "critical" },
  duplicates: { label: "Duplicates", tone: "serious" },
  in_review: { label: "In review", tone: "info" },
};

export type FoundListing = { name: string; address: string; phone: string; website: string; hours: string; categories: string[]; photos: number; hasDescription: boolean };

export type ListingRow = {
  id: string;
  name: string;
  domain: string;
  kind: Directory["kind"];
  weight: number;
  verification: boolean;
  status: ListingStatus;
  found: FoundListing | null;
  mismatches: FieldKey[];
  duplicates: number;
  suppressed: number;
  syncedAt: string | null;
  /** Share of NAP fields that match the profile (null when not listed). */
  accuracy: number | null;
};

