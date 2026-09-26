import { query } from "@/lib/db";
import { clamp, hash, rng, round } from "@/lib/seo/engine";
import type { Project } from "@/lib/projects";
import { analyzeSentiment, type Sentiment } from "@/lib/monitoring/sentiment";
import { localCompetitors } from "./competitors";
import type { BusinessProfile } from "./profile-schema";

/**
 * Review Management (demo): reviews are generated deterministically from templates for the project's
 * category and market (no platform APIs are connected). Replies you draft or mark as posted are real
 * and stored in local_review_replies.
 */

export const PLATFORMS: Record<string, { name: string; domain: string }> = {
  google: { name: "Google", domain: "google.com" },
  facebook: { name: "Facebook", domain: "facebook.com" },
  yelp: { name: "Yelp", domain: "yelp.com" },
  justdial: { name: "Justdial", domain: "justdial.com" },
  tripadvisor: { name: "Tripadvisor", domain: "tripadvisor.com" },
  trustpilot: { name: "Trustpilot", domain: "trustpilot.com" },
};

export type ReviewReply = { body: string; date: string; by: "demo" | "you"; status: "posted" | "draft" };
export type Review = {
  id: string;
  platform: string;
  author: string;
  rating: number;
  date: string;
  text: string;
  sentiment: Sentiment;
  sentimentScore: number;
  aspects: { aspect: string; positive: boolean }[];
  reply: ReviewReply | null;
};

const IN_FIRST = ["Aarav", "Priya", "Rohan", "Ananya", "Vikram", "Sneha", "Karan", "Neha", "Arjun", "Pooja", "Rahul", "Kavya", "Siddharth", "Isha", "Aditya", "Meera", "Harsh", "Riya", "Nikhil", "Divya", "Manish", "Shreya", "Yash", "Tanvi", "Deepak", "Anjali", "Kunal", "Nisha"];
const IN_LAST = ["Patel", "Shah", "Sharma", "Mehta", "Desai", "Iyer", "Reddy", "Joshi", "Gupta", "Nair", "Kapoor", "Trivedi", "Rao", "Verma", "Bhatt", "Singh", "Chauhan", "Pandya"];
const W_FIRST = ["James", "Olivia", "Liam", "Emma", "Noah", "Ava", "Lucas", "Mia", "Ethan", "Sophia", "Mason", "Isabella", "Logan", "Charlotte", "Daniel", "Amelia", "Jack", "Harper", "Ryan", "Chloe", "Nathan", "Grace", "Owen", "Zoe", "Sam", "Ella"];
const W_LAST = ["Smith", "Johnson", "Brown", "Garcia", "Miller", "Davis", "Wilson", "Taylor", "Clark", "Lewis", "Walker", "Young", "Allen", "King", "Wright", "Scott", "Hill", "Green", "Baker", "Turner"];

const SERVICE: [RegExp, string, boolean][] = [
  [/dent/i, "treatment", true],
  [/clinic|hospital|medical|doctor|health|physio/i, "consultation", true],
  [/vet|pet/i, "care", true],
  [/restaurant|food|dine|kitchen|grill/i, "food", false],
  [/cafe|coffee|bakery/i, "coffee", false],
  [/salon|hair|beauty|spa|nail/i, "haircut", false],
  [/gym|fitness|yoga/i, "training", false],
  [/law|legal|attorney/i, "advice", false],
  [/hotel|resort|inn/i, "stay", false],
  [/universit|college|school|academy|institute|coaching/i, "teaching", false],
  [/plumb|electric|repair|auto|car|garage/i, "work", false],
  [/store|shop|boutique|cloth/i, "collection", false],
];

type Pools = Record<string, { pos: string[]; neg: string[] }>;
const ASPECTS: Pools = {
  staff: {
    pos: ["The staff were friendly and very professional.", "{person} was patient and explained everything clearly.", "Reception team was polite and helpful.", "Everyone was so welcoming and caring."],
    neg: ["The staff at the front desk was rude.", "Nobody bothered to explain anything.", "{person} seemed in a hurry and careless.", "Staff were unhelpful when I asked questions."],
  },
  service: {
    pos: ["The {service} was excellent.", "Really happy with the {service}.", "Great quality {service}, exactly what I needed.", "Best {service} I have had in {city}."],
    neg: ["The {service} was disappointing.", "Poor quality {service}, I had to come back twice.", "The {service} was nothing like what was promised."],
  },
  price: {
    pos: ["Pricing is reasonable and transparent.", "Good value for money.", "Affordable compared to other places nearby."],
    neg: ["Way too expensive for what you get.", "They charged extra without telling me.", "Overpriced, and the bill had hidden charges."],
  },
  "wait time": {
    pos: ["Hardly any waiting time.", "They were on time for my appointment.", "Quick and efficient."],
    neg: ["Waited {n} minutes past my appointment time.", "The wait was far too long.", "Slow service, even when it was not busy."],
  },
  cleanliness: {
    pos: ["The place is clean and modern.", "Very clean and well maintained."],
    neg: ["The place was not very clean.", "Washrooms were dirty."],
  },
  location: {
    pos: ["Easy to find and plenty of parking.", "Convenient location."],
    neg: ["Parking is a nightmare.", "Hard to find the entrance."],
  },
  booking: {
    pos: ["Booking online was quick and easy.", "They replied quickly on WhatsApp and fixed a slot for me."],
    neg: ["My booking was cancelled without notice.", "Called three times, nobody answered."],
  },
};
const OPEN_POS = ["Great experience!", "Highly recommend.", "Excellent!", "", "Five stars.", "Very happy.", "", "Amazing place."];
const CLOSE_POS = ["Will definitely come back.", "Highly recommended!", "Thank you, team!", "", "Keep it up."];
const OPEN_NEG = ["Very disappointed.", "Terrible experience.", "Not happy.", "", "Worst experience so far."];
const CLOSE_NEG = ["Would not recommend.", "Hope the management fixes this.", "", "Avoid."];

const DEMO_REPLIES = {
  pos: ["Thank you so much, {first}! We're thrilled you had a great experience and look forward to seeing you again.", "Thanks for the kind words, {first}. The team will be delighted to read this!", "We appreciate your review, {first}. See you next time!"],
  neg: ["Hi {first}, we're sorry to hear this. Please call us so we can understand what happened and make it right.", "{first}, thank you for the feedback. This is not the experience we want for anyone; our manager will reach out to you."],
};

export const REPLY_TEMPLATES = [
  { id: "thanks", label: "Thank you (positive)", body: "Hi {first}, thank you so much for the {rating}-star review! We're delighted you had a great experience at {business}. We look forward to welcoming you again soon." },
  { id: "neutral", label: "Follow-up (mixed)", body: "Hi {first}, thanks for taking the time to share your feedback. We're glad parts of your visit went well, and we're already looking into the points you raised. Please reach us at {phone} so we can make your next visit better." },
  { id: "apology", label: "Apology (negative)", body: "Hi {first}, we're sorry to hear about your experience. This isn't the standard we aim for at {business}. Please contact us at {phone} so we can understand what happened and put it right." },
  { id: "custom", label: "Blank reply", body: "" },
];

function platformMix(country: string, category: string) {
  const list: [string, number][] = [["google", 0.62], ["facebook", 0.14]];
  if (country === "IN") list.push(["justdial", 0.14]);
  else if (["US", "GB", "CA", "AU", "IE", "NZ", "DE", "FR", "ES", "IT", "NL", "SE", "SG", "MX", "BR"].includes(country)) list.push(["yelp", 0.12]);
  if (/restaurant|food|cafe|hotel|resort|spa|bakery|travel/i.test(category)) list.push(["tripadvisor", 0.1]);
  if (/agency|software|store|shop|marketing|consult/i.test(category)) list.push(["trustpilot", 0.06]);
  return list;
}

const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Deterministic review sample for the last 12 months (newest first), without saved replies applied. */
export function generateReviews(project: Pick<Project, "domain" | "country" | "competitors">, profile: BusinessProfile, now = Date.now()): Review[] {
  const category = `${profile.primaryCategory} ${profile.categories.join(" ")}`;
  const you = localCompetitors(project, profile).find((b) => b.you)!;
  const seed = `reviews:${project.domain}:${profile.primaryCategory.toLowerCase()}`;
  const r = rng(seed);
  const perDay = (70 + 170 * you.strength) / 365;
  const svc = SERVICE.find((s) => s[0].test(category)) ?? [/./, "service", false];
  const indian = project.country === "IN";
  const first = indian ? IN_FIRST : W_FIRST;
  const last = indian ? IN_LAST : W_LAST;
  const staffPerson = svc[2] ? `Dr. ${r.pick(last)}` : r.pick(first);
  const platforms = platformMix(project.country, category);
  const q0 = clamp((you.rating - 1) / 4, 0, 1);
  // Reviews are seeded by their absolute date, so a review keeps its date and text over time and new
  // days bring new reviews.
  const today = Math.floor(now / DAY) * DAY;
  const out: Review[] = [];
  const slots: { age: number; key: string }[] = [];
  for (let age = 0; age < 365; age++) {
    const day = iso(today - age * DAY);
    const rd = rng(`${seed}:${day}`);
    // Poisson(perDay) arrivals.
    let k = -1;
    for (let p = 1, L = Math.exp(-perDay); p > L; k++) p *= rd.next();
    for (let j = 0; j < k; j++) slots.push({ age, key: `${seed}:${day}:${j}` });
  }
  for (const { age, key } of slots) {
    const ri = rng(key);
    const month = new Date(today - age * DAY).getUTCFullYear() * 12 + new Date(today - age * DAY).getUTCMonth();
    const q = clamp(q0 + 0.035 * Math.sin(month / 2.3), 0, 1);
    const weights = [0.12 * (1 - q) + 0.03, 0.08 * (1 - q) + 0.02, 0.12 * (1 - q) + 0.05, 0.22, 0.2 + 0.6 * q];
    const rating = ri.weighted([1, 2, 3, 4, 5], weights);
    const platform = ri.weighted(
      platforms.map((p) => p[0]),
      platforms.map((p) => p[1]),
    );
    const firstName = ri.pick(first);
    const author = `${firstName} ${ri.pick(last)[0]}.`;
    const fill = (s: string) => s.replace("{person}", staffPerson).replace("{service}", svc[1]).replace("{city}", profile.city.split(",")[0].trim() || "town").replace("{n}", String(ri.int(20, 75)));
    const aspects: { aspect: string; positive: boolean }[] = [];
    let text = "";
    if (!ri.chance(0.09)) {
      const keys = ri.sample(Object.keys(ASPECTS), rating === 3 ? 2 : ri.int(1, 3));
      const parts: string[] = [];
      if (rating >= 4) {
        parts.push(ri.pick(OPEN_POS));
        for (const k of keys) (parts.push(fill(ri.pick(ASPECTS[k].pos))), aspects.push({ aspect: k, positive: true }));
        parts.push(ri.pick(CLOSE_POS));
      } else if (rating === 3) {
        parts.push(fill(ri.pick(ASPECTS[keys[0]].pos)));
        aspects.push({ aspect: keys[0], positive: true });
        parts.push(`But ${fill(ri.pick(ASPECTS[keys[1] ?? "wait time"].neg)).replace(/^./, (c) => c.toLowerCase())}`);
        aspects.push({ aspect: keys[1] ?? "wait time", positive: false });
        parts.push(ri.pick(["Overall okay.", "Average experience.", "Could be better.", ""]));
      } else {
        parts.push(ri.pick(OPEN_NEG));
        for (const k of keys) (parts.push(fill(ri.pick(ASPECTS[k].neg))), aspects.push({ aspect: k, positive: false }));
        parts.push(ri.pick(CLOSE_NEG));
      }
      text = parts.filter(Boolean).join(" ");
    }
    const s = analyzeSentiment(text, rating);
    const date = today - age * DAY;
    const replyP = (platform === "google" ? 0.62 : 0.34) + (rating <= 2 ? 0.15 : 0);
    let reply: ReviewReply | null = null;
    if (age > 2 && ri.chance(replyP)) {
      const body = ri.pick(rating >= 4 ? DEMO_REPLIES.pos : DEMO_REPLIES.neg).replace("{first}", firstName);
      reply = { body, date: iso(Math.min(today, date + ri.int(0, 5) * DAY)), by: "demo", status: "posted" };
    }
    out.push({ id: hash(key).toString(36), platform, author, rating, date: iso(date), text, sentiment: s.label, sentimentScore: s.score, aspects, reply });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export async function savedReplies(projectId: string) {
  const rows = await query<{ review_id: string; body: string; status: "draft" | "posted"; updated_at: Date | string }>("SELECT review_id,body,status,updated_at FROM local_review_replies WHERE project_id=$1", [projectId]);
  return new Map(rows.map((r) => [r.review_id, { body: r.body, status: r.status, date: new Date(r.updated_at).toISOString().slice(0, 10), by: "you" as const }]));
}

export async function reviewsWithReplies(project: Project, profile: BusinessProfile) {
  const saved = await savedReplies(project.id);
  return generateReviews(project, profile).map((rv) => {
    const s = saved.get(rv.id);
    return s ? { ...rv, reply: s } : rv;
  });
}

export function reviewStats(reviews: Review[], now = Date.now()) {
  const total = reviews.length;
  const avg = total ? round(reviews.reduce((s, r) => s + r.rating, 0) / total, 2) : null;
  const distribution = [5, 4, 3, 2, 1].map((stars) => ({ stars, count: reviews.filter((r) => r.rating === stars).length }));
  const replied = reviews.filter((r) => r.reply?.status === "posted");
  const responseDays = replied.map((r) => (new Date(r.reply!.date).getTime() - new Date(r.date).getTime()) / DAY).filter((d) => d >= 0);
  const sentiment = { positive: 0, neutral: 0, negative: 0 } as Record<Sentiment, number>;
  for (const r of reviews) sentiment[r.sentiment]++;
  const months: { month: string; rating: number | null; reviews: number; positive: number; negative: number }[] = [];
  const d = new Date(now);
  for (let i = 11; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7);
    const list = reviews.filter((r) => r.date.startsWith(m));
    months.push({ month: m, rating: list.length ? round(list.reduce((s, r) => s + r.rating, 0) / list.length, 2) : null, reviews: list.length, positive: list.filter((r) => r.sentiment === "positive").length, negative: list.filter((r) => r.sentiment === "negative").length });
  }
  const platforms = Object.entries(
    reviews.reduce<Record<string, Review[]>>((acc, r) => {
      (acc[r.platform] ??= []).push(r);
      return acc;
    }, {}),
  )
    .map(([id, list]) => ({
      id,
      name: PLATFORMS[id]?.name ?? id,
      reviews: list.length,
      rating: round(list.reduce((s, r) => s + r.rating, 0) / list.length, 1),
      responseRate: round((list.filter((r) => r.reply?.status === "posted").length / list.length) * 100, 0),
      unanswered: list.filter((r) => r.reply?.status !== "posted").length,
    }))
    .sort((a, b) => b.reviews - a.reviews);
  const aspectMap = new Map<string, { positive: number; negative: number }>();
  for (const r of reviews)
    for (const a of r.aspects) {
      const m = aspectMap.get(a.aspect) ?? { positive: 0, negative: 0 };
      if (a.positive) m.positive++;
      else m.negative++;
      aspectMap.set(a.aspect, m);
    }
  const aspects = [...aspectMap.entries()].map(([aspect, v]) => ({ aspect, ...v, total: v.positive + v.negative })).sort((a, b) => b.total - a.total);
  const last30 = reviews.filter((r) => now - new Date(r.date).getTime() <= 30 * DAY);
  const prev30 = reviews.filter((r) => {
    const age = now - new Date(r.date).getTime();
    return age > 30 * DAY && age <= 60 * DAY;
  });
  const avgOf = (l: Review[]) => (l.length ? l.reduce((s, r) => s + r.rating, 0) / l.length : null);
  return {
    total,
    avg,
    distribution,
    responseRate: total ? round((replied.length / total) * 100, 1) : 0,
    replied: replied.length,
    awaiting: reviews.filter((r) => r.reply?.status !== "posted").length,
    negativeAwaiting: reviews.filter((r) => r.reply?.status !== "posted" && r.rating <= 2).length,
    avgResponseDays: responseDays.length ? round(responseDays.reduce((s, x) => s + x, 0) / responseDays.length, 1) : null,
    sentiment,
    months,
    platforms,
    aspects,
    last30: { count: last30.length, avg: avgOf(last30) },
    prev30: { count: prev30.length, avg: avgOf(prev30) },
  };
}
export type ReviewStats = ReturnType<typeof reviewStats>;

export function competitorRatings(project: Project, profile: BusinessProfile, stats: ReviewStats) {
  const all = localCompetitors(project, profile);
  const rivals = all.filter((b) => !b.you).sort((a, b) => b.reviews - a.reviews || b.strength - a.strength);
  const tracked = rivals.filter((b) => b.domain);
  const pick = [...tracked, ...rivals.filter((b) => !b.domain)].slice(0, 6);
  return [
    { id: "you", name: profile.name, you: true, rating: stats.avg ?? 0, reviews12: stats.total, responseRate: stats.responseRate, perMonth: round(stats.total / 12, 1) },
    ...pick.map((b) => ({ id: b.id, name: b.name, you: false, rating: b.rating, reviews12: Math.round(b.reviewsPerMonth * 12), responseRate: round(b.responseRate * 100, 0), perMonth: b.reviewsPerMonth })),
  ];
}
