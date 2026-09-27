import { Building2, Clock, Globe, MapPin, Phone, Tag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requirePageUser } from "@/lib/auth";
import { database } from "@/lib/domain";
import { latestJob } from "@/lib/jobs/queue";
import { buildListings, listingRows, STATUS_META, FIELD_LABELS, type ListingStatus } from "@/lib/local/listings";
import { getProfile, profileDefaults } from "@/lib/local/profile";
import { formatAddress, formatHours } from "@/lib/local/profile-schema";
import { projectContext } from "@/lib/local/project-context";
import { timeAgo } from "@/lib/format";
import { DataSourceBadge, DemoNotice } from "@/components/seo/source-badge";
import { NeedsData } from "@/components/seo/needs-data";
import { demoAllowed } from "@/lib/data-mode";
import { liveEnabled } from "@/lib/providers/source";
import { napCheck } from "@/lib/local/dfs-map";
import { getGoogleListing, profileNap } from "@/lib/local/live";
import { Grid, Page, PageHeader } from "@/components/shell/page";
import { ProjectGate } from "@/components/projects/project-gate";
import { ProjectSwitcher } from "@/components/projects/project-switcher";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { Bar, DistributionBar, ScoreRing } from "@/components/ui/progress";
import { JobProgress } from "@/components/local/job-progress";
import { DistributeButton, EditProfileButton, GoogleListingButton, ListingsTable } from "@/components/local/listings-ui";
import { ProfileForm } from "@/components/local/profile-form";

export const metadata: Metadata = { title: "Listing Management" };

const BREADCRUMBS = [{ label: "Local SEO" }, { label: "Listing Management", href: "/local/listings" }];
const STATUS_COLORS: Record<ListingStatus, string> = { synced: "var(--good)", in_review: "var(--series-1)", needs_update: "var(--warning)", duplicates: "var(--serious)", not_listed: "var(--critical)" };

export default async function ListingsPage({ searchParams }: PageProps<"/local/listings">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { projects, project, requested, switcher } = await projectContext(user.id, sp);

  if (!project)
    return (
      <Page>
        <PageHeader breadcrumbs={BREADCRUMBS} title="Listing Management" description="Keep your business name, address, phone and hours consistent across Google, Apple, Bing, Facebook and the directories customers use." />
        {requested && <Callout tone="warning" className="mb-4">That project was not found. Choose one of your projects below.</Callout>}
        <ProjectGate projects={projects} basePath="/local/listings" title="Listing Management" description="Choose the business whose listings you want to manage." />
      </Page>
    );

  const stored = await getProfile(project.id);
  const header = (subject: string, meta?: ReactNode, actions?: ReactNode) => (
    <PageHeader
      breadcrumbs={BREADCRUMBS}
      title="Listing Management:"
      subject={subject}
      meta={
        <>
          {demoAllowed() && <DataSourceBadge source="demo" />}
          {stored && <DataSourceBadge source="user" fetchedAt={stored.updatedAt} note="Business profile" />}
          <Badge>
            {database(project.country).flag} {database(project.country).name}
          </Badge>
          {meta}
        </>
      }
      actions={
        <>
          <ProjectSwitcher projects={switcher} current={project.id} />
          {actions}
        </>
      }
    />
  );

  if (!stored)
    return (
      <Page>
        {header(project.domain)}
        <Grid cols={2} className="lg:grid-cols-[1.7fr_1fr]">
          <Card>
            <CardHeader title="Set up your business profile" description="This is the single source of truth we compare every directory listing against and push when you distribute updates." />
            <CardBody>
              <ProfileForm projectId={project.id} initial={profileDefaults(project)} submitLabel="Save and scan listings" />
            </CardBody>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title="How it works" />
              <CardBody>
                <ol className="space-y-3 text-[13px] text-text-2">
                  {[
                    ["Add your profile", "Name, address, phone (NAP), website, categories and opening hours."],
                    ["Review found listings", "We check the directory network for missing listings, outdated details and duplicates."],
                    ["Distribute updates", "Push the profile to every directory in one click and suppress duplicates."],
                  ].map(([t, d], i) => (
                    <li key={t} className="flex gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[12px] font-semibold text-brand-ink">{i + 1}</span>
                      <span>
                        <span className="block font-medium text-text">{t}</span>
                        {d}
                      </span>
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
            {demoAllowed() ? (
              <Callout tone="warning" title="Demo data">
                Directory APIs are not connected in this environment. Listing statuses are simulated deterministically from your profile so you can explore the workflow.
              </Callout>
            ) : (
              <Callout tone="info" title="What is checked for real">
                {liveEnabled() ? "Your Google Business Profile listing is looked up on Google (DataForSEO) and compared field by field with this profile." : "Connect DataForSEO to compare your Google listing with this profile."} Other directories need a listings partner API.
              </Callout>
            )}
          </div>
        </Grid>
      </Page>
    );

  const profile = stored.profile;
  if (!demoAllowed()) {
    const g = await getGoogleListing(project.id);
    const checks = g?.listing ? napCheck(profileNap(profile), g.listing) : [];
    const matched = checks.filter((c) => c.match === true).length;
    const live = liveEnabled();
    return (
      <Page>
        <PageHeader
          breadcrumbs={BREADCRUMBS}
          title="Listing Management:"
          subject={profile.name}
          meta={
            <>
              <DataSourceBadge source="user" fetchedAt={stored.updatedAt} note="Business profile" />
              {g && <DataSourceBadge source="dataforseo" fetchedAt={g.fetchedAt} note="Google listing" />}
              <Badge>
                {database(project.country).flag} {database(project.country).name}
              </Badge>
            </>
          }
          actions={
            <>
              <ProjectSwitcher projects={switcher} current={project.id} />
              <EditProfileButton projectId={project.id} initial={profile} />
              {live && <GoogleListingButton projectId={project.id} label={g ? "Re-check Google" : "Check Google listing"} />}
            </>
          }
        />
        <Grid cols={2} className="mb-4 lg:grid-cols-[1fr_1.4fr]">
          <Card>
            <CardHeader title="Business profile" description={`Your source of truth · updated ${timeAgo(stored.updatedAt)}`} />
            <CardBody className="space-y-2.5 text-[13px]">
              <ProfileLine icon={<Building2 className="h-3.5 w-3.5" />} label={profile.name} />
              <ProfileLine icon={<MapPin className="h-3.5 w-3.5" />} label={formatAddress(profile)} />
              <ProfileLine icon={<Phone className="h-3.5 w-3.5" />} label={profile.phone || "No phone"} muted={!profile.phone} />
              <ProfileLine icon={<Globe className="h-3.5 w-3.5" />} label={profile.website || "No website"} muted={!profile.website} />
              <ProfileLine icon={<Tag className="h-3.5 w-3.5" />} label={[profile.primaryCategory, ...profile.categories].filter(Boolean).join(" · ") || "No category"} />
              <ProfileLine icon={<Clock className="h-3.5 w-3.5" />} label={formatHours(profile.hours)} />
            </CardBody>
          </Card>
          {!live ? (
            <NeedsData
              compact
              providers={["dataforseo", "business-profile"]}
              title="Checking your Google listing needs DataForSEO"
              shows={["Your live Google Business Profile listing", "Name, address, phone, website and category compared with your profile", "Google rating, review count and photos"]}
            />
          ) : !g ? (
            <Card>
              <CardHeader title="Google Business Profile" description="Not checked yet" />
              <CardBody className="text-[13px] text-text-2">
                <p>Look up “{[profile.name, profile.city].filter(Boolean).join(" ")}” on Google and compare the listing with your profile (about $0.005 of your DataForSEO budget).</p>
                <div className="mt-3 flex justify-start">
                  <GoogleListingButton projectId={project.id} />
                </div>
              </CardBody>
            </Card>
          ) : !g.listing ? (
            <Card>
              <CardHeader title="Google Business Profile" description={`Checked ${timeAgo(g.fetchedAt)}`} />
              <CardBody>
                <Callout tone="warning" title="No Google listing found">
                  Google returned no business for “{g.query}”. Check the business name and city in your profile, or create a Google Business Profile.
                </Callout>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Google Business Profile" description={`${matched} of ${checks.filter((c) => c.match != null).length} fields match your profile · checked ${timeAgo(g.fetchedAt)}`} />
              <CardBody>
                <MetricStrip className="mb-3 rounded-md border border-border">
                  <Metric label="Rating" value={g.listing.rating == null ? "n/a" : `${g.listing.rating.toFixed(1)} ★`} size="sm" />
                  <Metric label="Reviews" value={g.listing.reviews == null ? "n/a" : g.listing.reviews.toLocaleString()} size="sm" />
                  <Metric label="Photos" value={g.listing.photos == null ? "n/a" : g.listing.photos.toLocaleString()} size="sm" />
                  <Metric label="Claimed" value={g.listing.claimed == null ? "n/a" : g.listing.claimed ? "Yes" : "No"} size="sm" />
                </MetricStrip>
                <ul className="divide-y divide-border text-[13px]">
                  {checks.map((c) => (
                    <li key={c.field} className="grid grid-cols-[88px_1fr_auto] items-start gap-2 py-2">
                      <span className="text-text-3 capitalize">{c.field}</span>
                      <span className="min-w-0 break-words">
                        <span className="block text-text">{c.google || <span className="text-text-3">Not shown on Google</span>}</span>
                        {c.match === false && <span className="block text-[12px] text-text-3">Profile: {c.profile || "—"}</span>}
                      </span>
                      <Badge tone={c.match == null ? "neutral" : c.match ? "good" : "warning"}>{c.match == null ? "Missing" : c.match ? "Match" : "Differs"}</Badge>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </Grid>
        <NeedsData
          compact
          providers={["business-profile"]}
          title="Other directories need a listings partner"
          shows={["Listing status on Apple, Bing, Facebook, Yelp and local directories", "NAP consistency across the directory network", "Pushing profile updates and suppressing duplicates"]}
          className="mb-4"
        />
        <p className="text-[12px] text-text-3">
          The business profile is your own data. The Google listing is looked up live via DataForSEO; no directory statuses are simulated. See{" "}
          <Link href={`/local/map-rank-tracker?project=${project.id}`} className="text-link hover:underline">
            Map Rank Tracker
          </Link>{" "}
          and{" "}
          <Link href={`/local/reviews?project=${project.id}`} className="text-link hover:underline">
            Review Management
          </Link>
          .
        </p>
      </Page>
    );
  }
  const job = await latestJob(project.id, "local.distribute");
  const busy = !!job && (job.status === "queued" || job.status === "running");
  const view = buildListings(project, profile, await listingRows(project.id));
  const pendingCount = view.rows.filter((r) => r.status !== "synced" && r.status !== "in_review").length;

  const completeness = [
    { label: "Name, address & phone", ok: !!(profile.name && profile.street && profile.phone) },
    { label: "Website", ok: !!profile.website },
    { label: "Primary category", ok: !!profile.primaryCategory },
    { label: "Additional categories", ok: profile.categories.length > 0 },
    { label: "Opening hours", ok: profile.hours.some((h) => !h.closed) },
    { label: "Description (250+ characters)", ok: profile.description.length >= 250 },
    { label: "10+ photos", ok: profile.photos >= 10 },
    { label: "Map coordinates", ok: profile.lat != null },
  ];
  const completePct = Math.round((completeness.filter((c) => c.ok).length / completeness.length) * 100);
  const statusSegments = (["synced", "in_review", "needs_update", "duplicates", "not_listed"] as ListingStatus[]).map((s) => ({ label: STATUS_META[s].label, value: view.counts[s], color: STATUS_COLORS[s] }));

  return (
    <Page>
      {header(
        profile.name,
        view.lastSync ? <Badge>Last distributed {timeAgo(view.lastSync)}</Badge> : <Badge tone="warning">Never distributed</Badge>,
        <>
          <EditProfileButton projectId={project.id} initial={profile} />
          <DistributeButton projectId={project.id} count={pendingCount} disabled={busy} />
        </>,
      )}

      {busy && job && <JobProgress jobId={job.id} endpoint="/api/local/jobs" title="Distributing your business profile" className="mb-4" />}
      {!busy && job?.status === "failed" && (
        <Callout tone="critical" className="mb-4" title="The last distribution failed">
          {job.error}
        </Callout>
      )}

      <Card className="mb-4">
        <MetricStrip>
          <div className="flex items-center gap-3">
            <ScoreRing value={view.scores.overall} size={64} stroke={7} label={String(view.scores.overall)} />
            <Metric label="Listing score" value={`${view.scores.overall}/100`} info="Blend of presence (45%) and NAP accuracy (55%), minus a penalty for unsuppressed duplicates." />
          </div>
          <Metric label="Presence" value={`${view.scores.presence}%`} sub={`Listed on ${view.counts.listed} of ${view.counts.total} directories`} info="Importance-weighted share of directories where your business has a listing." />
          <Metric label="NAP accuracy" value={`${view.scores.accuracy}%`} sub="Name · address · phone · website" info="Importance-weighted share of NAP fields that match your profile on listed directories." />
          <Metric label="Needs attention" value={view.counts.needs_update + view.counts.not_listed + view.counts.duplicates} sub={`${view.counts.needs_update} outdated · ${view.counts.not_listed} missing · ${view.counts.duplicates} with duplicates`} />
          <Metric label="Duplicates found" value={view.counts.duplicateListings} sub={view.rows.reduce((s, r) => s + r.suppressed, 0) ? `${view.rows.reduce((s, r) => s + r.suppressed, 0)} suppressed so far` : "Suppressed when you distribute"} />
        </MetricStrip>
      </Card>

      <Grid cols={3} className="mb-4">
        <Card>
          <CardHeader title="Business profile" description={`Updated ${timeAgo(stored.updatedAt)} · ${completePct}% complete`} actions={<EditProfileButton projectId={project.id} initial={profile} />} />
          <CardBody className="space-y-2.5 text-[13px]">
            <ProfileLine icon={<Building2 className="h-3.5 w-3.5" />} label={profile.name} />
            <ProfileLine icon={<MapPin className="h-3.5 w-3.5" />} label={formatAddress(profile)} />
            <ProfileLine icon={<Phone className="h-3.5 w-3.5" />} label={profile.phone} />
            <ProfileLine icon={<Globe className="h-3.5 w-3.5" />} label={profile.website || "No website"} muted={!profile.website} />
            <ProfileLine icon={<Tag className="h-3.5 w-3.5" />} label={[profile.primaryCategory, ...profile.categories].join(" · ")} />
            <ProfileLine icon={<Clock className="h-3.5 w-3.5" />} label={formatHours(profile.hours)} />
            <div className="border-t border-border pt-2.5">
              <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
                <span className="font-medium text-text-2">Profile completeness</span>
                <span className="tabular text-text">{completePct}%</span>
              </div>
              <Bar value={completePct} color={completePct >= 80 ? "var(--good)" : completePct >= 50 ? "var(--warning)" : "var(--critical)"} />
              <ul className="mt-2 grid grid-cols-1 gap-1 text-[12px] sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {completeness.map((c) => (
                  <li key={c.label} className={c.ok ? "text-text-2" : "text-warning-ink"}>
                    {c.ok ? "✓" : "○"} {c.label}
                  </li>
                ))}
              </ul>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Listing status" description={`${view.counts.total} directories in the ${database(project.country).name} network`} />
          <CardBody>
            <DistributionBar segments={statusSegments} format={(v) => `${v}`} />
            <p className="mt-4 border-t border-border pt-3 text-[12.5px] text-text-3">
              {pendingCount > 0 ? (
                <>
                  <span className="font-medium text-text">{pendingCount} directories</span> are missing your listing, show outdated details or have duplicates. Distribute updates to fix them in one step.
                </>
              ) : (
                "Every directory shows your current profile. Edit the profile to push changes again."
              )}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="NAP consistency" info="How many listed directories show the same value as your profile, per field." />
          <CardBody>
            <ul className="space-y-2.5">
              {view.nap.map((n) => {
                const pct = n.total ? Math.round((n.consistent / n.total) * 100) : 0;
                return (
                  <li key={n.field}>
                    <div className="flex items-center justify-between text-[12.5px]">
                      <span className="text-text-2">{FIELD_LABELS[n.field]}</span>
                      <span className="tabular text-text">
                        {n.consistent}/{n.total} <span className="text-text-3">({pct}%)</span>
                      </span>
                    </div>
                    <Bar value={pct} className="mt-1" color={pct >= 90 ? "var(--good)" : pct >= 70 ? "var(--warning)" : "var(--critical)"} />
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      </Grid>

      <Card className="mb-4">
        <CardHeader title="Directory network" description="Click a directory to compare its listing with your profile." />
        <ListingsTable projectId={project.id} rows={view.rows} expected={view.expected} busy={busy} />
      </Card>

      {view.nap.some((n) => n.variants.length) && (
        <Card className="mb-4">
          <CardHeader title="Inconsistent details found" description="Outdated values customers may see on other sites. Distributing updates overwrites them." />
          <CardBody>
            <Grid cols={2}>
              {view.nap
                .filter((n) => n.variants.length)
                .map((n) => (
                  <div key={n.field} className="rounded-md border border-border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-text">{FIELD_LABELS[n.field]}</span>
                      <Badge tone="warning">{n.total - n.consistent} mismatched</Badge>
                    </div>
                    <ul className="space-y-1.5 text-[12.5px]">
                      {n.variants.slice(0, 4).map((v) => (
                        <li key={v.value} className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-medium break-all text-critical-ink">{v.value}</span>
                          <span className="text-text-3">on {v.directories.join(", ")}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </Grid>
          </CardBody>
        </Card>
      )}

      <p className="text-[12px] text-text-3">
        Listing statuses are <span className="font-medium text-warning-ink">Demo data</span>: no directory APIs are connected, so found listings are simulated deterministically from your profile. Use the{" "}
        <Link href={`/local/map-rank-tracker?project=${project.id}`} className="text-link hover:underline">
          Map Rank Tracker
        </Link>{" "}
        and{" "}
        <Link href={`/local/reviews?project=${project.id}`} className="text-link hover:underline">
          Review Management
        </Link>{" "}
        for the same business.
      </p>
      <DemoNotice className="mt-2" />
    </Page>
  );
}

function ProfileLine({ icon, label, muted }: { icon: ReactNode; label: string; muted?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-text-3">{icon}</span>
      <span className={muted ? "text-text-3" : "break-words text-text"}>{label}</span>
    </div>
  );
}
