"use client";

import { LogOut, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { disconnectGoogleAction, linkGoogleAction, refreshGoogleDataAction } from "@/app/(app)/organic-traffic-insights/actions";
import type { InsightPage } from "@/lib/google/data";
import { compact, displayUrl, pct } from "@/lib/format";
import { KeywordLink } from "@/components/seo/badges";
import { Button, buttonClass } from "@/components/ui/button";
import { CellLink, DataTable, type Column } from "@/components/ui/data-table";
import { Callout } from "@/components/ui/feedback";
import { Field, Select } from "@/components/ui/input";

/** Google's sign-in button styling is not required for a plain link; keep it consistent with the app. */
export function ConnectGoogleButton({ returnTo, label = "Connect Google account" }: { returnTo: string; label?: string }) {
  return (
    <a href={`/api/integrations/google/start?returnTo=${encodeURIComponent(returnTo)}`} className={buttonClass("primary", "md")}>
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
        <path fill="#fff" d="M21.35 11.1H12v2.9h5.35c-.23 1.4-1.64 4.1-5.35 4.1-3.22 0-5.85-2.66-5.85-5.95S8.78 6.2 12 6.2c1.83 0 3.06.78 3.76 1.45l2.57-2.47C16.68 3.62 14.55 2.7 12 2.7 6.92 2.7 2.8 6.82 2.8 11.9S6.92 21.1 12 21.1c6.93 0 9.2-4.86 9.2-7.35 0-.49-.05-.87-.12-1.25z" />
      </svg>
      {label}
    </a>
  );
}

export function DisconnectGoogleButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={pending}
      onClick={() => {
        if (!confirm("Disconnect your Google account? Linked projects keep their settings but show no data until you reconnect.")) return;
        start(async () => {
          await disconnectGoogleAction();
          router.refresh();
        });
      }}
    >
      <LogOut className="h-3.5 w-3.5" /> Disconnect
    </Button>
  );
}

export function RefreshGoogleButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      loading={pending}
      onClick={() =>
        start(async () => {
          await refreshGoogleDataAction();
          router.refresh();
        })
      }
      title="Google data is cached for 6 hours"
    >
      <RefreshCw className="h-4 w-4" /> Refresh
    </Button>
  );
}

export function LinkPropertiesForm({
  projectId,
  sites,
  properties,
  current,
  suggestedSite,
}: {
  projectId: string;
  sites: { siteUrl: string; permissionLevel: string }[];
  properties: { property: string; name: string; account: string }[];
  current: { gscSite: string | null; ga4Property: string | null };
  suggestedSite: string | null;
}) {
  const router = useRouter();
  const [gsc, setGsc] = useState(current.gscSite ?? suggestedSite ?? "");
  const [ga4, setGa4] = useState(current.ga4Property ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const prop = properties.find((p) => p.property === ga4);
          const res = await linkGoogleAction(projectId, { gscSite: gsc || null, ga4Property: ga4 || null, ga4PropertyName: prop ? `${prop.name} (${prop.account})` : null });
          if (!res.ok) return setError(res.error);
          router.push(`/organic-traffic-insights?project=${projectId}`);
          router.refresh();
        });
      }}
    >
      {error && <Callout tone="critical">{error}</Callout>}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Search Console property" htmlFor="gsc" hint={sites.length ? "Domain properties (sc-domain:) include every subdomain and protocol." : "No verified properties on this Google account."}>
          <Select id="gsc" value={gsc} onChange={(e) => setGsc(e.target.value)}>
            <option value="">Don't use Search Console</option>
            {sites.map((s) => (
              <option key={s.siteUrl} value={s.siteUrl}>
                {s.siteUrl} ({s.permissionLevel.replace(/^site/, "").toLowerCase()})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Google Analytics 4 property" htmlFor="ga4" hint={properties.length ? "Organic sessions, engagement and key events per landing page." : "No GA4 properties on this Google account."}>
          <Select id="ga4" value={ga4} onChange={(e) => setGa4(e.target.value)}>
            <option value="">Don't use Google Analytics</option>
            {properties.map((p) => (
              <option key={p.property} value={p.property}>
                {p.name} · {p.account} ({p.property.replace("properties/", "")})
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={pending} disabled={!gsc && !ga4}>
          Save and load data
        </Button>
      </div>
    </form>
  );
}

type QueryRow = { query: string; clicks: number; impressions: number; ctr: number; position: number };

export function QueriesTable({ rows, db }: { rows: QueryRow[]; db: string }) {
  const columns: Column<QueryRow>[] = [
    { key: "query", header: "Query", render: (r) => <KeywordLink keyword={r.query} db={db} /> },
    { key: "clicks", header: "Clicks", align: "right", render: (r) => compact(r.clicks) },
    { key: "impressions", header: "Impressions", align: "right", render: (r) => compact(r.impressions) },
    { key: "ctr", header: "CTR", align: "right", sortValue: (r) => r.ctr, render: (r) => pct(r.ctr * 100), csv: (r) => (r.ctr * 100).toFixed(2) },
    { key: "position", header: "Avg. position", align: "right", render: (r) => r.position.toFixed(1), csv: (r) => r.position.toFixed(1) },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.query}
      defaultSort={{ key: "clicks", dir: "desc" }}
      searchable
      searchPlaceholder="Filter queries"
      searchText={(r) => r.query}
      exportName="search-console-queries"
      selectable
      selectionActions={(selected) => (
        <a className={buttonClass("secondary", "sm")} href={`/position-tracking?import=${encodeURIComponent(selected.slice(0, 300).map((r) => r.query).join(","))}`}>
          Track in Position Tracking
        </a>
      )}
    />
  );
}

export function PagesTable({ rows }: { rows: InsightPage[] }) {
  const n = (v: number | null, f: (x: number) => string = compact) => (v == null ? <span className="text-text-3">n/a</span> : f(v));
  const columns: Column<InsightPage>[] = [
    {
      key: "path",
      header: "Landing page",
      render: (r) =>
        r.url ? (
          <CellLink href={r.url} external>
            <span className="block max-w-[360px] truncate" title={r.url}>
              {displayUrl(r.url)}
            </span>
          </CellLink>
        ) : (
          <span className="block max-w-[360px] truncate text-text" title={r.path}>
            {r.path}
          </span>
        ),
      csv: (r) => r.url ?? r.path,
    },
    { key: "topQuery", header: "Top query", sortValue: (r) => r.topQuery ?? "", render: (r) => (r.topQuery ? <span className="block max-w-[220px] truncate text-text-2">{r.topQuery}</span> : n(null)) },
    { key: "queries", header: "Queries", align: "right", sortValue: (r) => r.queries ?? -1, render: (r) => n(r.queries) },
    { key: "clicks", header: "Clicks", align: "right", sortValue: (r) => r.clicks ?? -1, render: (r) => n(r.clicks) },
    { key: "impressions", header: "Impressions", align: "right", sortValue: (r) => r.impressions ?? -1, render: (r) => n(r.impressions) },
    { key: "position", header: "Avg. pos.", align: "right", sortValue: (r) => r.position ?? 999, render: (r) => n(r.position, (x) => x.toFixed(1)) },
    { key: "sessions", header: "Organic sessions", align: "right", sortValue: (r) => r.sessions ?? -1, render: (r) => n(r.sessions) },
    { key: "engagementRate", header: "Engagement", align: "right", sortValue: (r) => r.engagementRate ?? -1, render: (r) => n(r.engagementRate, (x) => pct(x * 100)) },
    { key: "keyEvents", header: "Key events", align: "right", sortValue: (r) => r.keyEvents ?? -1, render: (r) => n(r.keyEvents) },
  ];
  return <DataTable rows={rows} columns={columns} rowKey={(r) => r.path} defaultSort={{ key: "clicks", dir: "desc" }} searchable searchPlaceholder="Filter pages" searchText={(r) => `${r.path} ${r.topQuery ?? ""}`} exportName="organic-traffic-insights-pages" />;
}
