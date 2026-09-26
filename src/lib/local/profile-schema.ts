/** Business profile shape + validation. Client-safe (used by the form and the server action). */
import { z } from "zod";

export const DAYS = [
  { id: "mon", label: "Monday", short: "Mon" },
  { id: "tue", label: "Tuesday", short: "Tue" },
  { id: "wed", label: "Wednesday", short: "Wed" },
  { id: "thu", label: "Thursday", short: "Thu" },
  { id: "fri", label: "Friday", short: "Fri" },
  { id: "sat", label: "Saturday", short: "Sat" },
  { id: "sun", label: "Sunday", short: "Sun" },
] as const;
export type DayId = (typeof DAYS)[number]["id"];

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)");
const dayHours = z
  .object({ day: z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]), closed: z.boolean(), open: time, close: time })
  .refine((h) => h.closed || h.open < h.close, { message: "Closing time must be after opening time" });

export const profileInput = z.object({
  name: z.string().trim().min(2, "Business name is required").max(100),
  street: z.string().trim().min(3, "Street address is required").max(200),
  city: z.string().trim().min(2, "City is required").max(80),
  region: z.string().trim().max(80).default(""),
  postalCode: z.string().trim().max(20).default(""),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s().-]{7,22}$/, "Enter a valid phone number, e.g. +91 265 123 4567")
    .refine((p) => p.replace(/\D/g, "").length >= 7, "Phone number needs at least 7 digits"),
  website: z
    .string()
    .trim()
    .max(255)
    .refine((w) => !w || /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(w), "Website must start with http:// or https://")
    .default(""),
  primaryCategory: z.string().trim().min(2, "Primary category is required").max(80),
  categories: z.array(z.string().trim().min(2).max(80)).max(9, "At most 9 additional categories").default([]),
  hours: z.array(dayHours).length(7),
  description: z.string().trim().max(750, "Descriptions are limited to 750 characters").default(""),
  photos: z.coerce.number().int().min(0).max(10000).default(0),
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),
});
export type ProfileInput = z.input<typeof profileInput>;
export type BusinessProfile = z.output<typeof profileInput>;

export const DEFAULT_HOURS: BusinessProfile["hours"] = DAYS.map((d) => ({ day: d.id, closed: d.id === "sun", open: "09:00", close: d.id === "sat" ? "14:00" : "18:00" }));

export const CATEGORY_SUGGESTIONS = [
  "Dentist",
  "Restaurant",
  "Cafe",
  "Hair salon",
  "Gym",
  "Medical clinic",
  "Hospital",
  "Law firm",
  "Plumber",
  "Electrician",
  "Real estate agency",
  "Hotel",
  "University",
  "College",
  "School",
  "Bakery",
  "Auto repair shop",
  "Pharmacy",
  "Veterinarian",
  "Spa",
  "Marketing agency",
  "Software company",
  "Clothing store",
  "Coaching center",
];

export function formatAddress(p: Pick<BusinessProfile, "street" | "city" | "region" | "postalCode">) {
  return [p.street, p.city, [p.region, p.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}
export function formatHours(h: BusinessProfile["hours"]) {
  const groups: string[] = [];
  let i = 0;
  while (i < h.length) {
    let j = i;
    const key = (x: (typeof h)[number]) => (x.closed ? "closed" : `${x.open}-${x.close}`);
    while (j + 1 < h.length && key(h[j + 1]) === key(h[i])) j++;
    const label = DAYS.find((d) => d.id === h[i].day)!.short + (j > i ? `–${DAYS.find((d) => d.id === h[j].day)!.short}` : "");
    groups.push(`${label} ${h[i].closed ? "Closed" : `${h[i].open}–${h[i].close}`}`);
    i = j + 1;
  }
  return groups.join(", ");
}
