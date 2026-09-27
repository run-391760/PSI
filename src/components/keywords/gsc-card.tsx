import { ExternalLink, Link2 } from "lucide-react";
import Link from "next/link";
import { compact, displayUrl, pct } from "@/lib/format";
import type { GscStatus, SitePerformance } from "@/lib/keywords/gsc";
import { KeywordLink } from "@/components/seo/badges";
import { NeedsData } from "@/components/seo/needs-data";
import { DataSourceBadge } from "@/components/seo/source-badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Metric } from "@/components/ui/metric";
import { MiniTable } from "@/components/ui/mini-table";

const siteLabel = (s: string) => s.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/$/, "");

/** "Your site" card: the user's real Search Console performance for a keyword (Keyword Overview). */
export function GscKeywordCard({ keyword, db, sites, status, className }: { keyword: string; db: string; sites: SitePerformance[]; status: GscStatus; className?: string }) {
  if (!status.configured)
    return (
      <NeedsData
        compact
        className={className}
        providers={["google"]}
        title="Connect Search Console to see how your site performs for this keyword"
        shows={["Your clicks, impressions, CTR and average position", "The page of yours that ranks for it", "Your other queries containing this keyword"]}
      />
    );
  if (!status.sites)
    return (
      <Card className={className}>
        <CardHeader title="Your site" description="Search Console" />
        <CardBody>
          <p className="text-[13px] text-text-2">None of your projects is linked to a Search Console property yet. Link one to see your clicks, impressions and position for keywords you research.</p>
          <Link href="/organic-traffic-insights" className="mt-3 inline-flex items-center gap-1 text-[13px] text-link hover:underline">
            <Link2 className="h-3.5 w-3.5" /> Link Search Console
          </Link>
        </CardBody>
      </Card>
    );
  const main = sites[0];
  const found = sites.filter((s) => s.exact);
  const related = main?.related ?? [];
  return (
    <Card className={className}>
      <CardHeader
        title="Your site"
        description={`Search Console · last 3 months · ${status.sites} linked propert${status.sites === 1 ? "y" : "ies"}`}
        actions={<DataSourceBadge source="search-console" fetchedAt={status.fetchedAt ?? undefined} />}
      />
      <CardBody>
        {found.length ? (
          <div className="space-y-4">
            {found.slice(0, 3).map((s) => (
              <div key={s.site}>
                <div className="mb-2 text-[12.5px] text-text-2">
                  <span className="font-medium text-text">{s.project}</span> · {siteLabel(s.site)}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Metric label="Clicks" value={compact(s.exact!.clicks)} size="sm" />
                  <Metric label="Impressions" value={compact(s.exact!.impressions)} size="sm" />
                  <Metric label="CTR" value={pct(s.exact!.ctr * 100)} size="sm" />
                  <Metric label="Avg. position" value={s.exact!.position.toFixed(1)} size="sm" />
                </div>
                {s.pages[0] && (
                  <div className="mt-2 text-[12.5px] text-text-2">
                    Ranking page:{" "}
                    <a href={s.pages[0].url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-link hover:underline" title={s.pages[0].url}>
                      <span className="truncate">{displayUrl(s.pages[0].url)}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                    {s.pages.length > 1 && <span className="text-text-3"> · +{s.pages.length - 1} more page{s.pages.length > 2 ? "s" : ""}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-text-2">
            None of your linked sites received impressions for “{keyword}” in the last 3 months{related.length ? ", but they appear for related queries:" : "."}
          </p>
        )}
        {related.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-[11.5px] font-semibold tracking-wide text-text-3 uppercase">Your queries containing “{keyword}”</div>
            <MiniTable
              columns={[{ header: "Query" }, { header: "Impr.", align: "right" }, { header: "Clicks", align: "right" }, { header: "Pos.", align: "right" }]}
              rows={related.slice(0, 6).map((r) => [<KeywordLink key="k" keyword={r.query} db={db} className="line-clamp-1 break-all" />, compact(r.impressions), compact(r.clicks), r.position.toFixed(1)])}
            />
          </div>
        )}
        {status.errors.length > 0 && <p className="mt-3 text-[12px] text-warning-ink">Some properties could not be read: {status.errors.join("; ")}</p>}
      </CardBody>
    </Card>
  );
}
