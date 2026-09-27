import type { AutocompleteInfo } from "@/lib/keywords/types";
import { Tooltip } from "@/components/ui/tooltip";
import { DataSourceBadge } from "@/components/seo/source-badge";

/** Where keyword metrics came from; "none"/"autocomplete" = no metrics provider connected. */
export type MetricsOrigin = "dataforseo" | "demo" | "none" | "autocomplete";

/**
 * Provenance badges for keyword reports: metrics source (only when a real one, or local demo mode),
 * Google Autocomplete when it contributed, and Search Console when the user's own data is shown.
 */
export function SourceBadges({
  source,
  fetchedAt,
  autocomplete,
  gsc,
}: {
  source: MetricsOrigin;
  fetchedAt?: string;
  autocomplete?: AutocompleteInfo;
  gsc?: { fetchedAt: string | null; note?: string } | null;
}) {
  return (
    <>
      {(source === "dataforseo" || source === "demo") && <DataSourceBadge source={source} fetchedAt={fetchedAt} />}
      {autocomplete?.status === "ok" && autocomplete.count > 0 && (
        <DataSourceBadge source="google-autocomplete" fetchedAt={autocomplete.fetchedAt} note={`${autocomplete.count.toLocaleString()} real suggestions`} />
      )}
      {autocomplete?.status === "failed" && (
        <Tooltip content={`Google Autocomplete could not be reached (${autocomplete.error ?? "unknown error"}). It will be retried.`} side="bottom">
          <span className="inline-flex h-6 items-center rounded-full border border-border-strong px-2.5 text-[11.5px] font-medium text-text-3">Autocomplete unavailable</span>
        </Tooltip>
      )}
      {gsc && <DataSourceBadge source="search-console" fetchedAt={gsc.fetchedAt ?? undefined} note={gsc.note} />}
    </>
  );
}
