import { Badge } from "@/components/ui/badge";
import { compact, timeAgo } from "@/lib/format";
import type { FetchReport, SourceStatus } from "@/lib/cx/listening/data";
import { SourceIcon } from "./source-icon";

/** Per-source connection state (catalogue connect info when not configured) and last fetch result. */
export function SourceStatusList({ sources, report }: { sources: SourceStatus[]; report: FetchReport | Record<string, never> }) {
  const r = "sources" in report ? report.sources : {};
  return (
    <ul className="divide-y divide-border">
      {sources.map((s) => {
        const last = r[s.source];
        return (
          <li key={s.source} className="px-4 py-3">
            <div className="flex items-center gap-2">
              <SourceIcon source={s.source} />
              <span className="text-[13px] font-medium text-text">{s.name}</span>
              <span className="ml-auto">{s.available ? <Badge tone="good">Connected</Badge> : <Badge tone="warning">Needs key</Badge>}</span>
            </div>
            <div className="mt-1 pl-8 text-[12px] text-text-3">
              {s.api} · {s.costNote}
            </div>
            {!s.available && (
              <div className="mt-1.5 ml-8 rounded-md bg-surface-2 px-2.5 py-2 text-[12px] text-text-2">
                <div>{s.setup}</div>
                {s.env.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.env.map((e) => (
                      <code key={e} className="rounded bg-surface-3 px-1 text-[11.5px] text-text">{e}</code>
                    ))}
                  </div>
                )}
              </div>
            )}
            {s.available && last && (
              <div className="mt-1 pl-8 text-[12px]">
                {last.error ? (
                  <span className="text-critical-ink">{last.error}</span>
                ) : last.skipped && !last.fetched ? (
                  <span className="text-text-3">Skipped: {last.skipped}</span>
                ) : (
                  <span className="text-text-2">
                    {compact(last.fetched)} matched · {compact(last.inserted)} new{"at" in report ? ` · ${timeAgo(report.at)}` : ""}
                  </span>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
