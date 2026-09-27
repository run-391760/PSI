import type { SummaryProvider } from "@/lib/projects/summary-types";
import { latestJob } from "@/lib/jobs/queue";
import { compact } from "@/lib/format";
import { buildListings, listingRows } from "./listings";
import { listScans } from "./map-rank";
import { getProfile } from "./profile";
import { generateReviews, reviewStats, reviewsFromLive, savedReplies } from "./reviews";
import { demoAllowed } from "@/lib/data-mode";
import { napCheck } from "./dfs-map";
import { getGoogleListing, getLiveReviews, profileNap } from "./live";

/** Project dashboard widgets for the local module: real Google data (DataForSEO); demo data only with DEMO_DATA=true. */
export const summaries: SummaryProvider[] = [
  async (project) => {
    const base = { tool: "local", label: "Listing Management", href: `/local/listings?project=${project.id}` };
    const stored = await getProfile(project.id);
    if (!stored) return { ...base, state: "empty", cta: "Add business profile" };
    if (!demoAllowed()) {
      const g = await getGoogleListing(project.id);
      if (!g) return { ...base, state: "empty", cta: "Check Google listing", note: "Compare your profile with Google" };
      if (!g.listing) return { ...base, state: "ready", headline: { label: "Google listing", value: "Not found" }, updatedAt: g.fetchedAt, note: "DataForSEO" };
      const checks = napCheck(profileNap(stored.profile), g.listing);
      const shown = checks.filter((c) => c.match != null);
      return {
        ...base,
        state: "ready",
        headline: { label: "Google NAP match", value: `${checks.filter((c) => c.match).length}/${shown.length}` },
        stats: [
          { label: "Rating", value: g.listing.rating == null ? "n/a" : `${g.listing.rating.toFixed(1)} ★` },
          { label: "Reviews", value: g.listing.reviews == null ? "n/a" : compact(g.listing.reviews) },
          { label: "Claimed", value: g.listing.claimed == null ? "n/a" : g.listing.claimed ? "Yes" : "No" },
        ],
        updatedAt: g.fetchedAt,
        note: "DataForSEO",
      };
    }
    const job = await latestJob(project.id, "local.distribute");
    const view = buildListings(project, stored.profile, await listingRows(project.id));
    return {
      ...base,
      state: job && (job.status === "queued" || job.status === "running") ? "running" : "ready",
      headline: { label: "Listing score", value: `${view.scores.overall}/100` },
      stats: [
        { label: "Synced", value: `${view.counts.synced}/${view.counts.total}` },
        { label: "Needs update", value: String(view.counts.needs_update) },
        { label: "Not listed", value: String(view.counts.not_listed) },
      ],
      updatedAt: view.lastSync ?? stored.updatedAt,
      note: "Demo data",
    };
  },
  async (project) => {
    const base = { tool: "local-map", label: "Map Rank Tracker", href: `/local/map-rank-tracker?project=${project.id}` };
    const scans = (await listScans(project.id, 12)).filter((s) => s.status === "done" || s.status === "running" || s.status === "queued");
    if (!scans.length) return { ...base, state: "empty", cta: "Run a grid scan" };
    const latest = scans.find((s) => s.status === "done");
    const running = scans[0].status !== "done";
    if (!latest) return { ...base, state: "running" };
    // Compare with the previous scan that used the same grid and radius (otherwise shares are not comparable).
    const prev = scans.find((s) => s.status === "done" && s.id !== latest.id && s.created_at < latest.created_at && s.grid_size === latest.grid_size && s.radius_km === latest.radius_km);
    const delta = prev?.solv != null && latest.solv != null && prev.solv > 0 ? ((latest.solv - prev.solv) / prev.solv) * 100 : null;
    return {
      ...base,
      state: running ? "running" : "ready",
      headline: { label: "Share of local voice", value: `${latest.solv ?? 0}%`, delta, upIsGood: true },
      stats: [
        { label: "Avg. rank", value: latest.avgRank == null ? "20+" : String(latest.avgRank) },
        { label: "Top-3 points", value: `${latest.top3Pct ?? 0}%` },
        { label: "Grid", value: `${latest.grid_size}×${latest.grid_size}` },
      ],
      spark: scans
        .filter((s) => s.status === "done")
        .reverse()
        .map((s) => s.solv ?? 0),
      updatedAt: latest.finished_at ?? latest.created_at,
      note: latest.source === "demo" ? "Demo data" : "Google Maps · DataForSEO",
    };
  },
  async (project) => {
    const base = { tool: "local-reviews", label: "Review Management", href: `/local/reviews?project=${project.id}` };
    const stored = await getProfile(project.id);
    if (!stored) return { ...base, state: "empty", cta: "Add business profile" };
    const saved = await savedReplies(project.id);
    const live = demoAllowed() ? null : await getLiveReviews(project.id);
    if (!demoAllowed() && !live) return { ...base, state: "empty", cta: "Fetch Google reviews" };
    const reviews = live ? reviewsFromLive(live.reviews, saved) : generateReviews(project, stored.profile).map((r) => (saved.has(r.id) ? { ...r, reply: saved.get(r.id)! } : r));
    const s = reviewStats(reviews);
    const delta = s.last30.avg != null && s.prev30.avg != null ? ((s.last30.avg - s.prev30.avg) / s.prev30.avg) * 100 : null;
    return {
      ...base,
      state: "ready",
      headline: { label: "Average rating", value: s.avg == null ? "n/a" : `${s.avg.toFixed(1)} ★`, delta, upIsGood: true },
      stats: [
        { label: "Reviews", value: compact(s.total) },
        { label: "Response rate", value: `${Math.round(s.responseRate)}%` },
        { label: "Awaiting reply", value: String(s.awaiting) },
      ],
      spark: s.months.map((m) => m.rating ?? 0),
      updatedAt: live?.fetchedAt ?? new Date().toISOString(),
      note: live ? "Google reviews · DataForSEO" : "Demo data",
    };
  },
];
