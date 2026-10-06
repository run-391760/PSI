"use client";

import { ExternalLink, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { deleteKeywordsAction, tagKeywordsAction } from "@/app/(app)/position-tracking/actions";
import { compact, dayLabel, displayUrl, money, pct } from "@/lib/format";
import type { OverviewRow, TagRef } from "@/lib/position-tracking/types";
import type { SerpFeature } from "@/lib/seo/types";
import { DomainAvatar, FeatureIcon, IntentBadges, KdBadge, featureLabel } from "@/components/seo/badges";
import { TrendChart } from "@/components/charts/trend-chart";
import { Button, ButtonLink } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Callout, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Drawer } from "./drawer";
import { PosDiff, TagChip, domainColor, domainDashed } from "./ui";

type Detail = {
  rows: { day: string; positions: Record<string, number | null>; urls: Record<string, string | null>; own_urls: { url: string; position: number }[]; features: SerpFeature[]; owned: SerpFeature[]; fs_owner: string | null }[];
  serp: { day: string; results: { d: string; p: number; u: string }[] } | null;
  domains: string[];
  device: string;
  error?: string;
};

export function KeywordDrawer({
  row,
  onClose,
  projectId,
  domain,
  domains,
  device,
  range,
  db,
  allTags,
  measured = false,
}: {
  row: OverviewRow | null;
  onClose: () => void;
  projectId: string;
  domain: string;
  domains: string[];
  device: string;
  range: number;
  db: string;
  allTags: TagRef[];
  measured?: boolean;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [newTag, setNewTag] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { confirm, confirmDialog } = useConfirm();

  const rowId = row?.id ?? null;
  useEffect(() => {
    if (!rowId) return;
    let alive = true;
    setDetail(null);
    setError(null);
    fetch(`/api/position-tracking/keywords/${rowId}?device=${device}&range=${range}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Detail) => alive && (d.error ? setError(d.error) : setDetail(d)))
      .catch(() => alive && setError("Could not load keyword history."));
    return () => {
      alive = false;
    };
  }, [rowId, device, range]);

  const chart = useMemo(() => {
    if (!detail) return [];
    return detail.rows.map((r) => {
      const point: Record<string, unknown> = { day: r.day };
      domains.forEach((d, i) => (point[`d${i}`] = r.positions[d] ?? null));
      return point;
    });
  }, [detail, domains]);

  const urlHistory = useMemo(() => {
    if (!detail) return [];
    const map = new Map<string, { url: string; first: string; last: string; days: number; best: number }>();
    for (const r of detail.rows)
      for (const u of r.own_urls ?? []) {
        const e = map.get(u.url) ?? { url: u.url, first: r.day, last: r.day, days: 0, best: u.position };
        e.last = r.day;
        e.days++;
        e.best = Math.min(e.best, u.position);
        map.set(u.url, e);
      }
    return [...map.values()].sort((a, b) => b.last.localeCompare(a.last) || b.days - a.days);
  }, [detail]);

  const tagAction = (tag: { id?: string; name?: string }, mode: "add" | "remove") =>
    start(async () => {
      if (!row) return;
      setError(null);
      const res = await tagKeywordsAction(projectId, [row.id], tag, mode);
      if (!res.ok) setError(res.error);
      else setNewTag("");
      router.refresh();
    });

  const latest = detail?.rows[detail.rows.length - 1];
  const tracked = new Set(domains);

  return (
    <Drawer
      open={Boolean(row)}
      onClose={onClose}
      title={row?.keyword ?? ""}
      subtitle={
        row && (
          <span className="flex flex-wrap items-center gap-2">
            <IntentBadges intents={row.intents} />
            {row.tags.map((t) => (
              <TagChip key={t.id} name={t.name} />
            ))}
            <span className="text-text-3">{device === "mobile" ? "Mobile" : "Desktop"} · last {range} days</span>
          </span>
        )
      }
      actions={
        row && (
          <ButtonLink href={`/keyword-overview?q=${encodeURIComponent(row.keyword)}&db=${db}`} size="sm" variant="ghost" title="Open in Keyword Overview">
            <Search className="h-3.5 w-3.5" /> Keyword Overview
          </ButtonLink>
        )
      }
    >
      {row && (
        <div className="space-y-5">
          {error && <Callout tone="critical">{error}</Callout>}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border p-3 sm:grid-cols-4">
            <Fact label="Position">
              <span className="text-[20px] font-semibold">{row.end ?? "–"}</span> <PosDiff previous={row.start} current={row.end} />
            </Fact>
            <Fact label="Best in range">{row.best ?? "–"}</Fact>
            {measured ? (
              <>
                <Fact label="Clicks (range)">{compact(row.clicks ?? 0)}</Fact>
                <Fact label="Impressions">{compact(row.impressions ?? 0)}</Fact>
              </>
            ) : (
              <>
                <Fact label="Visibility">{pct(row.visibility, 1)}</Fact>
                <Fact label="Est. traffic">{row.traffic == null ? "n/a" : compact(row.traffic)}</Fact>
              </>
            )}
            <Fact label="Volume">{row.volume == null ? "n/a" : compact(row.volume)}</Fact>
            {measured ? (
              <Fact label="CTR">{row.ctr == null ? "n/a" : pct(row.ctr, 1)}</Fact>
            ) : (
              <Fact label="KD %">
                <KdBadge kd={row.kd} />
              </Fact>
            )}
            <Fact label="CPC">{row.cpc == null ? "n/a" : money(row.cpc)}</Fact>
            <Fact label="Landing page">
              {row.url ? (
                <a href={row.url} target="_blank" rel="noopener noreferrer" className="block truncate text-link hover:underline" title={row.url}>
                  {displayUrl(row.url).replace(/^www\./, "")}
                </a>
              ) : (
                <span className="text-text-3">–</span>
              )}
            </Fact>
          </dl>

          <section>
            <h3 className="mb-2 text-[13.5px] font-semibold">Position history</h3>
            {!detail ? (
              <Skeleton className="h-[260px] w-full" />
            ) : chart.length > 1 ? (
              <TrendChart
                data={chart}
                xKey="day"
                xFormat="day"
                yFormat="position"
                reversed
                yDomain={[1, "dataMax"]}
                series={domains.map((d, i) => ({ key: `d${i}`, label: d, color: domainColor(i), dashed: domainDashed(i) }))}
                height={260}
              />
            ) : (
              <p className="py-10 text-center text-[13px] text-text-3">History appears after the second daily check.</p>
            )}
            <p className="mt-1 text-[11.5px] text-text-3">{measured ? "Search Console daily average position. Gaps mean no impressions that day." : "Gaps mean the domain was not in the top 100 that day."}</p>
          </section>

          <section>
            <h3 className="mb-2 text-[13.5px] font-semibold">Tags</h3>
            <div className="flex flex-wrap items-center gap-1.5">
              {row.tags.length === 0 && <span className="text-[12.5px] text-text-3">No tags.</span>}
              {row.tags.map((t) => (
                <TagChip key={t.id} name={t.name} onRemove={() => tagAction({ id: t.id }, "remove")} />
              ))}
            </div>
            <form
              className="mt-2 flex max-w-sm gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const name = newTag.trim();
                if (!name) return;
                const existing = allTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
                tagAction(existing ? { id: existing.id } : { name }, "add");
              }}
            >
              <Input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Add a tag" list="pt-drawer-tags" className="h-7.5 text-[12.5px]" maxLength={40} aria-label="Tag name" />
              <datalist id="pt-drawer-tags">
                {allTags.map((t) => (
                  <option key={t.id} value={t.name} />
                ))}
              </datalist>
              <Button type="submit" size="sm" loading={pending} disabled={!newTag.trim()}>
                Add
              </Button>
            </form>
          </section>

          <section>
            <h3 className="mb-2 text-[13.5px] font-semibold">Landing pages</h3>
            {!detail ? (
              <Skeleton className="h-16 w-full" />
            ) : urlHistory.length ? (
              <ul className="divide-y divide-border rounded-lg border border-border text-[12.5px]">
                {urlHistory.map((u) => (
                  <li key={u.url} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                    <a href={u.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-link hover:underline" title={u.url}>
                      {displayUrl(u.url)}
                    </a>
                    <span className="text-text-3">
                      {u.days} day{u.days === 1 ? "" : "s"} · best #{u.best} · {dayLabel(u.first)}
                      {u.first !== u.last ? ` – ${dayLabel(u.last)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-text-3">{domain} did not rank for this keyword in the range.</p>
            )}
            {urlHistory.length > 1 && <p className="mt-1.5 text-[12px] text-warning-ink">Several URLs ranked for this keyword — check the Cannibalization report.</p>}
          </section>

          {measured ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[12.5px] text-text-3">
              SERP features and the live top 20 need DataForSEO — Search Console only reports your own site.
            </p>
          ) : (
            <>
          <section>
            <h3 className="mb-2 text-[13.5px] font-semibold">SERP features</h3>
            {latest && latest.features.filter((f) => f !== "related_searches").length ? (
              <ul className="flex flex-wrap gap-1.5">
                {latest.features
                  .filter((f) => f !== "related_searches")
                  .map((f) => {
                    const own = latest.owned.includes(f);
                    return (
                      <li key={f} className={own ? "inline-flex items-center gap-1.5 rounded-md bg-brand-soft px-2 py-1 text-[12px] font-medium text-brand-ink" : "inline-flex items-center gap-1.5 rounded-md bg-surface-3 px-2 py-1 text-[12px] text-text-2"}>
                        <FeatureIcon feature={f} /> {featureLabel(f)}
                        {own && <span className="text-[11px]">· yours</span>}
                        {f === "featured_snippet" && !own && latest.fs_owner && <span className="text-[11px] text-text-3">· {latest.fs_owner}</span>}
                      </li>
                    );
                  })}
              </ul>
            ) : (
              <p className="text-[12.5px] text-text-3">{detail ? "No SERP features recorded." : "Loading…"}</p>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-[13.5px] font-semibold">
              Top 20 results {detail?.serp && <span className="font-normal text-text-3">· {dayLabel(detail.serp.day)}</span>}
            </h3>
            {!detail ? (
              <Skeleton className="h-40 w-full" />
            ) : detail.serp?.results.length ? (
              <ol className="divide-y divide-border rounded-lg border border-border text-[12.5px]">
                {detail.serp.results.map((r) => (
                  <li key={`${r.p}-${r.u}`} className={tracked.has(r.d) ? "flex items-center gap-2.5 bg-brand-soft/40 px-3 py-1.5" : "flex items-center gap-2.5 px-3 py-1.5"}>
                    <span className="tabular w-6 shrink-0 text-right text-text-3">{r.p}</span>
                    <DomainAvatar domain={r.d} size={16} />
                    <span className={tracked.has(r.d) ? "w-40 shrink-0 truncate font-medium text-text" : "w-40 shrink-0 truncate text-text-2"}>{r.d}</span>
                    <a href={r.u} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-link hover:underline" title={r.u}>
                      {displayUrl(r.u)}
                    </a>
                    <ExternalLink className="h-3 w-3 shrink-0 text-text-3" />
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[12.5px] text-text-3">The SERP snapshot is stored on the next check.</p>
            )}
            <p className="mt-1 text-[11.5px] text-text-3">Your position in this list can differ slightly from the tracked position, which is measured daily.</p>
          </section>
            </>
          )}

          <div className="flex justify-end border-t border-border pt-4">
            <Button
              variant="ghost"
              className="text-critical-ink"
              loading={pending}
              onClick={async () => {
                if (!(await confirm({ title: `Stop tracking “${row.keyword}”?`, description: "Its ranking history will be deleted.", confirmLabel: "Stop tracking" }))) return;
                start(async () => {
                  const res = await deleteKeywordsAction(projectId, [row.id]);
                  if (!res.ok) return setError(res.error);
                  onClose();
                  router.refresh();
                });
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Stop tracking this keyword
            </Button>
            {confirmDialog}
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-text-3">{label}</dt>
      <dd className="mt-0.5 truncate text-[13.5px] text-text">{children}</dd>
    </div>
  );
}

