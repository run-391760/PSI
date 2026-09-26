import type { AutocompleteInfo } from "@/lib/keywords/types";
import type { DataSource } from "@/lib/providers/labels";
import { Tooltip } from "@/components/ui/tooltip";
import { DataSourceBadge } from "@/components/seo/source-badge";

/** Provenance badges for keyword reports: metrics source + Google Autocomplete when it contributed. */
export function SourceBadges({ source, fetchedAt, autocomplete }: { source: DataSource; fetchedAt?: string; autocomplete?: AutocompleteInfo }) {
  return (
    <>
      <DataSourceBadge source={source} fetchedAt={fetchedAt} />
      {autocomplete?.status === "ok" && autocomplete.count > 0 && (
        <DataSourceBadge source="google-autocomplete" fetchedAt={autocomplete.fetchedAt} note={`${autocomplete.count.toLocaleString()} real suggestions`} />
      )}
      {autocomplete?.status === "failed" && (
        <Tooltip content={`Google Autocomplete could not be reached (${autocomplete.error ?? "unknown error"}). Showing other sources only; it will be retried.`} side="bottom">
          <span className="inline-flex h-6 items-center rounded-full border border-border-strong px-2.5 text-[11.5px] font-medium text-text-3">Autocomplete unavailable</span>
        </Tooltip>
      )}
    </>
  );
}
