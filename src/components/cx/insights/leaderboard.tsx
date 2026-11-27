import { Medal } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { MiniTable } from "@/components/ui/mini-table";
import { LEADERBOARD_DAYS, type LeaderRow } from "@/lib/cx/insights/leaderboard";
import { cn } from "@/lib/utils";

/** "45m", "3h 20m", "2d 4h": time spans for first response and resolution. */
function span(seconds: number | null) {
  if (seconds == null) return "n/a";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
  return `${Math.floor(h / 24)}d${h % 24 ? ` ${h % 24}h` : ""}`;
}
const pctOrNa = (v: number | null) => (v == null ? "n/a" : `${Math.round(v)}%`);
const MEDAL = ["text-[#d4a017]", "text-[#9aa3ad]", "text-[#b87333]"];

/** Settings → Users: who did the most work in the period. Server component; the period is the `lb` URL param. */
export function Leaderboard({ rows, days, href }: { rows: LeaderRow[]; days: number; href: (days: number) => string }) {
  const active = rows.filter((r) => r.rank > 0);
  return (
    <Card className="mt-6" id="leaderboard">
      <CardHeader
        title="User leaderboard"
        description={`Ranked by tickets solved, then replies sent, then faster first response. Last ${days} days.`}
        actions={
          <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Period">
            {LEADERBOARD_DAYS.map((d) => (
              <Link key={d} href={href(d)} scroll={false} aria-current={d === days ? "true" : undefined}
                className={cn("rounded px-2 py-0.5 text-[12px]", d === days ? "bg-brand-soft font-medium text-link" : "text-text-2 hover:text-text")}>
                {d}d
              </Link>
            ))}
          </div>
        }
      />
      <div className="px-4 pb-3">
        <MiniTable
          empty="No users on this brand yet."
          columns={[
            { header: "#", className: "w-10" }, { header: "User" },
            { header: "Replies", align: "right" }, { header: "Assigned", align: "right" }, { header: "Solved", align: "right" },
            { header: "Avg first response", align: "right" }, { header: "Avg resolution", align: "right" },
            { header: "SLA met", align: "right" }, { header: "CSAT", align: "right" }, { header: "QA", align: "right" },
          ]}
          rows={rows.map((r) => [
            r.rank ? (r.rank <= 3 ? <Medal key="m" className={cn("h-4 w-4", MEDAL[r.rank - 1])} aria-label={`Rank ${r.rank}`} /> : <span key="r" className="tabular text-text-2">{r.rank}</span>) : <span key="n" className="text-text-3">–</span>,
            <span key="u" className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-text">{r.name}</span>
              <span className="truncate text-[11.5px] text-text-3">{r.email}{r.role ? ` · ${r.role}` : ""}</span>
            </span>,
            r.replies, r.assigned, r.solved,
            span(r.frt), span(r.art),
            pctOrNa(r.sla),
            r.csat == null ? "n/a" : <span key="c" title={`${r.csatN} rating${r.csatN === 1 ? "" : "s"}`}>{Math.round(r.csat)}%</span>,
            r.qa == null ? "n/a" : `${Math.round(r.qa)}`,
          ])}
        />
        {rows.length > 0 && !active.length && <p className="mt-2 text-[12.5px] text-text-3">No replies or tickets in the last {days} days yet.</p>}
        {active.length > 0 && <p className="mt-2 text-[11.5px] text-text-3"><Badge tone="info" className="mr-1.5">{active.length} active</Badge>Replies count messages sent from the inbox; failed sends are excluded. n/a means there is nothing to measure yet.</p>}
      </div>
    </Card>
  );
}
