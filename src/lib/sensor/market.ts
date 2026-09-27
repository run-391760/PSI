import { query } from "@/lib/db";
import { database } from "@/lib/domain";
import { enqueue } from "@/lib/jobs/queue";
import type { JobHandler } from "@/lib/jobs/types";
import { dfs, market } from "@/lib/providers/dataforseo";
import { liveEnabled } from "@/lib/providers/source";
import { lastDays, todayIso } from "./days";
import { domainMovers, featureShares, marketSeries, snapshotFromSerp, type SerpSnapshot } from "./volatility";

/**
 * SERP Sensor market score from real data: once per UTC day and regional database × device, the top 10
 * Google results of a fixed panel of broad head keywords are fetched from DataForSEO and stored in
 * sensor_serps. Volatility, SERP-feature shares and winners/losers are computed from those snapshots.
 * Costs about 20 × $0.002 per database/device/day, reserved against the budget of the user whose
 * visit triggered the day's collection.
 */

export const SENSOR_PANEL = [
  "weather",
  "news",
  "best laptop",
  "cheap flights",
  "car insurance",
  "mortgage rates",
  "credit card",
  "running shoes",
  "pizza near me",
  "hotels",
  "how to lose weight",
  "diabetes symptoms",
  "online degree",
  "jobs",
  "iphone",
  "netflix",
  "recipes",
  "home loan",
  "vpn",
  "football",
];
const SNAPSHOT_KIND = "sensor.snapshot";
const PER_CALL_MICROS = 2500;

type Device = "desktop" | "mobile";
type Row = { keyword: string; day: string; results: SerpSnapshot["results"]; features: string[] };

export async function loadSnapshots(db: string, device: Device, days = 31): Promise<SerpSnapshot[]> {
  const from = lastDays(days)[0];
  const rows = await query<Row>("SELECT keyword, day, results, features FROM sensor_serps WHERE db=$1 AND device=$2 AND day >= $3 ORDER BY day", [db, device, from]);
  return rows.map((r) => ({ keyword: r.keyword, day: r.day, results: r.results ?? [], features: r.features ?? [] }));
}

/** Everything the Sensor page shows for the market panel, or null when there is nothing stored. */
export async function marketOverview(dbInput: string, device: Device) {
  const db = database(dbInput).code;
  const snaps = await loadSnapshots(db, device);
  const series = marketSeries(snaps);
  const [{ fetched }] = await query<{ fetched: string | Date | null }>("SELECT max(fetched_at) AS fetched FROM sensor_serps WHERE db=$1 AND device=$2", [db, device]);
  const days = [...new Set(snaps.map((s) => s.day))].sort();
  const last = days[days.length - 1];
  const prev = days[days.length - 2];
  const features = featureShares(snaps);
  return {
    db,
    device,
    snapshots: snaps.length,
    days: days.length,
    fetchedAt: fetched ? new Date(fetched).toISOString() : null,
    series,
    today: series[series.length - 1] ?? null,
    yesterday: series[series.length - 2] ?? null,
    avg30: series.length ? Math.round((series.reduce((s, d) => s + d.score, 0) / series.length) * 10) / 10 : null,
    features,
    movers: last && prev ? domainMovers(snaps.filter((s) => s.day === prev), snaps.filter((s) => s.day === last)) : { winners: [], losers: [] },
  };
}
export type MarketOverview = Awaited<ReturnType<typeof marketOverview>>;

/** Queue today's panel collection once per database × device (no-op without DataForSEO). */
export async function ensureTodaySnapshot(ownerId: string, dbInput: string, device: Device) {
  if (!liveEnabled()) return null;
  const db = database(dbInput).code;
  const day = todayIso();
  const [{ n }] = await query<{ n: number }>("SELECT count(*)::int AS n FROM sensor_serps WHERE db=$1 AND device=$2 AND day=$3", [db, device, day]);
  if (n >= SENSOR_PANEL.length * 0.8) return null;
  return enqueue({ kind: SNAPSHOT_KIND, ownerId, payload: { db, device, day }, dedupeKey: `sensor:${db}:${device}:${day}` });
}

export const sensorJobs: Record<string, JobHandler> = {
  [SNAPSHOT_KIND]: async (job, ctx) => {
    const db = database(String(job.payload.db ?? "US")).code;
    const device: Device = job.payload.device === "mobile" ? "mobile" : "desktop";
    const day = String(job.payload.day ?? todayIso());
    if (!job.owner_id) throw new Error("Missing owner.");
    const have = new Set((await query<{ keyword: string }>("SELECT keyword FROM sensor_serps WHERE db=$1 AND device=$2 AND day=$3", [db, device, day])).map((r) => r.keyword));
    const todo = SENSOR_PANEL.filter((k) => !have.has(k));
    let done = 0;
    const errors: string[] = [];
    for (const keyword of todo) {
      if (await ctx.cancelled()) return { cancelled: true, done };
      await ctx.progress(done, todo.length, `Fetching Google results for “${keyword}”`);
      try {
        const [result] = await dfs(job.owner_id, "serp/google/organic/live/regular", { keyword, ...market(db), device, depth: 10 }, PER_CALL_MICROS);
        const snap = snapshotFromSerp(keyword, day, result as Record<string, unknown> | undefined);
        if (snap.results.length)
          await query(
            `INSERT INTO sensor_serps(db,device,day,keyword,results,features) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)
             ON CONFLICT(db,device,day,keyword) DO UPDATE SET results=excluded.results, features=excluded.features, fetched_at=now()`,
            [db, device, day, keyword, JSON.stringify(snap.results), JSON.stringify(snap.features)],
          );
      } catch (e) {
        errors.push(`${keyword}: ${e instanceof Error ? e.message : String(e)}`);
        // Budget exhausted or credentials rejected: every further call would fail too.
        if (/budget|credentials/i.test(String(e))) break;
      }
      done++;
    }
    await ctx.progress(todo.length, todo.length, "Done");
    if (errors.length && errors.length === todo.length) throw new Error(errors[0]);
    return { db, device, day, fetched: todo.length - errors.length, errors: errors.slice(0, 5) };
  },
};
