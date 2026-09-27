"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { compact, displayUrl, num, pct } from "@/lib/format";
import { DataTable } from "@/components/ui/data-table";
import { Select } from "@/components/ui/input";
import { Delta } from "./ui";

export type PageRow = {
  url: string;
  keywords: number;
  keywordsDelta: number;
  visibility: number;
  visibilityDelta: number;
  traffic: number;
  avgPosition: number | null;
  top10: number;
  topKeywords: { keyword: string; position: number; id: string }[];
};

export function DomainSelect({ domains, value, param = "domain" }: { domains: string[]; value: string; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  return (
    <Select
      value={value}
      onChange={(e) => {
        const params = new URLSearchParams(search.toString());
        if (e.target.value === domains[0]) params.delete(param);
        else params.set(param, e.target.value);
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      }}
      className="h-8 w-auto max-w-64 text-[12.5px]"
      aria-label="Domain"
    >
      {domains.map((d, i) => (
        <option key={d} value={d}>
          {d}
          {i === 0 ? " (you)" : ""}
        </option>
      ))}
    </Select>
  );
}

export function PagesTable({ rows, domains, domain, exportName, kwBase, trafficLabel = "Est. traffic" }: { rows: PageRow[]; domains: string[]; domain: string; exportName: string; kwBase: string | null; trafficLabel?: string }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.url}
      defaultSort={{ key: "visibility", dir: "desc" }}
      exportName={exportName}
      searchable
      searchPlaceholder="Filter by URL or keyword"
      searchText={(r) => `${r.url} ${r.topKeywords.map((k) => k.keyword).join(" ")}`}
      toolbar={<DomainSelect domains={domains} value={domain} />}
      emptyText={`${domain} has no ranking pages for the tracked keywords.`}
      columns={[
        {
          key: "url",
          header: "Landing page",
          sortValue: (r) => r.url,
          render: (r) => (
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="block max-w-[380px] truncate text-link hover:underline" title={r.url}>
              {displayUrl(r.url).replace(/^www\./, "")}
            </a>
          ),
        },
        { key: "keywords", header: "Keywords", align: "right" },
        { key: "keywordsDelta", header: "Change", align: "right", render: (r) => <Delta value={r.keywordsDelta} digits={0} /> },
        { key: "visibility", header: "Visibility", align: "right", info: "Share of the campaign's visibility contributed by this page.", render: (r) => pct(r.visibility, 2), csv: (r) => r.visibility.toFixed(2) },
        { key: "visibilityDelta", header: "Vis. change", align: "right", render: (r) => <Delta value={r.visibilityDelta} digits={2} />, csv: (r) => r.visibilityDelta.toFixed(2) },
        { key: "traffic", header: trafficLabel, align: "right", render: (r) => compact(r.traffic) },
        { key: "avgPosition", header: "Avg. position", align: "right", render: (r) => (r.avgPosition == null ? "n/a" : num(r.avgPosition, 1)), csv: (r) => r.avgPosition?.toFixed(1) },
        { key: "top10", header: "Top 10", align: "right" },
        {
          key: "topKeywords",
          header: "Top keywords",
          sortable: false,
          render: (r) => (
            <span className="block max-w-[320px] truncate text-[12.5px] text-text-2">
              {r.topKeywords.map((k, i) => (
                <span key={k.id}>
                  {i > 0 && ", "}
                  {kwBase ? (
                    <a href={`${kwBase}&kw=${k.id}`} className="hover:text-link hover:underline">
                      {k.keyword}
                    </a>
                  ) : (
                    k.keyword
                  )}
                  <span className="text-text-3"> #{k.position}</span>
                </span>
              ))}
            </span>
          ),
          csv: (r) => r.topKeywords.map((k) => `${k.keyword} (#${k.position})`).join("; "),
        },
      ]}
    />
  );
}
