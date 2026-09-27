import { query } from "@/lib/db";
import { demoAllowed } from "@/lib/data-mode";
import { liveEnabled } from "@/lib/providers/source";
import type { JobContext, JobRow } from "@/lib/jobs/types";
import { evaluateAlerts } from "./alerts";
import { demoCollector, liveSerp, liveVolumes, parseLiveSerp, type SerpTop, type Snapshot } from "./collect";
import { addDays, aggregateDay, daysBetween, today, type RankRow } from "./metrics";
import { fetchGscSnapshots, gscEndDay, linkedGscSite } from "./gsc";
import { gscWindow } from "./gsc-map";
import { getCampaign } from "./store";
import { BACKFILL_DAYS, type Campaign, type Device } from "./types";

export type CheckPayload = {
  /** Demo: compute this many trailing days (initial setup). */
  backfill?: number;
  /** Only these keywords (newly added) — backfilled over the campaign's existing history. */
  keywordIds?: string[];
  /** Recompute the whole history (targeting/competitors changed). */
  rebuild?: boolean;
  scheduled?: boolean;
  manual?: boolean;
};

const maxDay = (a: string, b: string) => (a > b ? a : b);

type RankInsert = Snapshot & { project_id: string; keyword_id: string; device: Device; day: string; source: string; clicks?: number | null; impressions?: number | null };

async function flushRankings(rows: RankInsert[]) {
  if (!rows.length) return;
  await query(
    `INSERT INTO pt_rankings(project_id,keyword_id,device,day,positions,urls,own_urls,features,owned,fs_owner,source,clicks,impressions)
     SELECT x.project_id,x.keyword_id,x.device,x.day,x.positions,x.urls,x.own_urls,x.features,x.owned,x.fs_owner,x.source,x.clicks,x.impressions
     FROM jsonb_to_recordset($1::jsonb) AS x(project_id text, keyword_id text, device text, day text, positions jsonb, urls jsonb, own_urls jsonb, features jsonb, owned jsonb, fs_owner text, source text, clicks real, impressions real)
     ON CONFLICT(keyword_id,device,day) DO UPDATE SET positions=excluded.positions, urls=excluded.urls, own_urls=excluded.own_urls,
       features=excluded.features, owned=excluded.owned, fs_owner=excluded.fs_owner, source=excluded.source, clicks=excluded.clicks, impressions=excluded.impressions`,
    [JSON.stringify(rows)],
  );
}

async function flushSerps(rows: { project_id: string; keyword_id: string; device: Device; day: string; results: SerpTop }[]) {
  if (!rows.length) return;
  await query(
    `INSERT INTO pt_serps(project_id,keyword_id,device,day,results)
     SELECT x.project_id,x.keyword_id,x.device,x.day,x.results FROM jsonb_to_recordset($1::jsonb) AS x(project_id text, keyword_id text, device text, day text, results jsonb)
     ON CONFLICT(keyword_id,device) DO UPDATE SET day=excluded.day, results=excluded.results`,
    [JSON.stringify(rows)],
  );
}

/** Recomputes pt_daily (per-domain aggregates) for a day range from the stored snapshots. */
export async function rebuildDaily(projectId: string, from: string, to: string, devices: Device[], domains: string[], measured = false) {
  const volumes = new Map(
    (await query<{ id: string; volume: number | null }>("SELECT id, volume FROM pt_keywords WHERE project_id=$1", [projectId])).map((r) => [r.id, r.volume]),
  );
  for (const device of devices) {
    const rows = await query<RankRow>(
      "SELECT keyword_id, day, positions, features, clicks, impressions FROM pt_rankings WHERE project_id=$1 AND device=$2 AND day>=$3 AND day<=$4",
      [projectId, device, from, to],
    );
    const byDay = new Map<string, RankRow[]>();
    for (const r of rows) {
      if (!volumes.has(r.keyword_id)) continue;
      const list = byDay.get(r.day) ?? [];
      list.push(r);
      byDay.set(r.day, list);
    }
    const out = [...byDay.entries()].flatMap(([day, list]) =>
      aggregateDay(day, list, domains, volumes, { measured }).map((a) => ({
        project_id: projectId,
        device,
        day,
        domain: a.domain,
        keywords: a.keywords,
        ranked: a.ranked,
        top3: a.top3,
        top10: a.top10,
        top20: a.top20,
        top100: a.top100,
        visibility: a.visibility,
        traffic: a.traffic,
        avg_position: a.avgPosition,
        clicks: a.clicks,
        impressions: a.impressions,
      })),
    );
    await query("DELETE FROM pt_daily WHERE project_id=$1 AND device=$2 AND day>=$3 AND day<=$4", [projectId, device, from, to]);
    for (let i = 0; i < out.length; i += 3000)
      await query(
        `INSERT INTO pt_daily(project_id,device,day,domain,keywords,ranked,top3,top10,top20,top100,visibility,traffic,avg_position,clicks,impressions)
         SELECT x.* FROM jsonb_to_recordset($1::jsonb) AS x(project_id text, device text, day text, domain text, keywords int, ranked int, top3 int, top10 int, top20 int, top100 int, visibility real, traffic real, avg_position real, clicks real, impressions real)
         ON CONFLICT(project_id,device,day,domain) DO UPDATE SET keywords=excluded.keywords, ranked=excluded.ranked, top3=excluded.top3, top10=excluded.top10,
           top20=excluded.top20, top100=excluded.top100, visibility=excluded.visibility, traffic=excluded.traffic, avg_position=excluded.avg_position,
           clicks=excluded.clicks, impressions=excluded.impressions`,
        [JSON.stringify(out.slice(i, i + 3000))],
      );
  }
}

/** Rebuilds all aggregates of a campaign (after keywords were removed). */
export async function rebuildAllDaily(projectId: string) {
  const c = await getCampaign(projectId);
  if (!c?.firstDay || !c.lastDay) return;
  const [p] = await query<{ domain: string }>("SELECT domain FROM projects WHERE id=$1", [projectId]);
  const devices: Device[] = c.device === "both" ? ["desktop", "mobile"] : [c.device];
  const gsc = c.source === "search-console";
  await rebuildDaily(projectId, c.firstDay, c.lastDay, devices, gsc ? [p.domain] : [p.domain, ...c.competitors], gsc);
}

async function updateCampaignDays(projectId: string, from: string, to: string) {
  await query(
    `UPDATE pt_campaigns SET last_check_at=now(), first_day=CASE WHEN first_day IS NULL OR first_day>$2 THEN $2 ELSE first_day END,
       last_day=CASE WHEN last_day IS NULL OR last_day<$3 THEN $3 ELSE last_day END WHERE project_id=$1`,
    [projectId, from, to],
  );
}

/** Fills keyword volume/CPC from DataForSEO (Google Ads data) when it is configured; otherwise volume stays n/a. */
async function fillVolumes(ownerId: string, db: string, keywords: { id: string; keyword: string; metrics_source: string }[]) {
  if (!liveEnabled()) return;
  const pending = keywords.filter((k) => k.metrics_source !== "dataforseo");
  if (!pending.length) return;
  const vols = await liveVolumes(ownerId, pending.map((k) => k.keyword), db).catch(() => new Map<string, { volume: number | null; cpc: number | null }>());
  const updates = pending.filter((k) => vols.has(k.keyword)).map((k) => ({ id: k.id, volume: vols.get(k.keyword)!.volume, cpc: vols.get(k.keyword)!.cpc }));
  if (updates.length)
    await query(
      `UPDATE pt_keywords k SET volume=x.volume, cpc=x.cpc, metrics_source='dataforseo' FROM jsonb_to_recordset($1::jsonb) AS x(id text, volume int, cpc real) WHERE k.id=x.id`,
      [JSON.stringify(updates)],
    );
}

type ProjectRow = { id: string; owner_id: string; domain: string; name: string };

/**
 * Search Console check: daily average position, clicks, impressions and ranking pages of the project's own site
 * for each tracked keyword (exact query) and device. Setup backfills 90 days; daily runs re-fetch the last 3
 * stored days (Search Console revises recent data) plus any newer days.
 */
async function runGscCheck(project: ProjectRow, campaign: Campaign, payload: CheckPayload, keywords: { id: string; keyword: string; metrics_source: string }[], devices: Device[], ctx: JobContext) {
  const site = await linkedGscSite(project.id);
  if (!site) throw new Error("This project is not linked to a Search Console property any more. Link it in Organic Traffic Insights, then update again.");
  const end = gscEndDay();
  const history = Boolean(payload.keywordIds || payload.rebuild);
  const win = gscWindow({ end, lastDay: campaign.lastDay, firstDay: campaign.firstDay, backfill: payload.backfill, history });
  await ctx.progress(0, keywords.length, `Fetching ${daysBetween(win.from, win.to).length} days of Search Console data`);
  await fillVolumes(project.owner_id, campaign.db, keywords);
  const { days, snapshots } = await fetchGscSnapshots({
    userId: project.owner_id,
    site,
    domain: project.domain,
    db: campaign.db,
    keywords,
    devices,
    from: win.from,
    to: win.to,
    onBatch: (done, total) => ctx.progress(done, total, `Fetched ${done} of ${total} keywords from Search Console`),
    cancelled: () => ctx.cancelled(),
  });
  if (await ctx.cancelled()) return { cancelled: true };
  if (!days.length) {
    await query("UPDATE pt_campaigns SET last_check_at=now() WHERE project_id=$1", [project.id]);
    return { days: 0, keywords: keywords.length, source: "search-console", note: "Search Console has no data for this period yet." };
  }
  await ctx.progress(keywords.length, keywords.length, "Updating reports");
  const rows: RankInsert[] = snapshots.map((s) => ({ ...s, project_id: project.id, source: "search-console" }));
  for (let i = 0; i < rows.length; i += 2500) await flushRankings(rows.slice(i, i + 2500));
  const from = days[0];
  const last = days[days.length - 1];
  await rebuildDaily(project.id, from, last, devices, [project.domain], true);
  await updateCampaignDays(project.id, from, last);
  let alerts = 0;
  if (!payload.backfill && !payload.keywordIds && !payload.rebuild) alerts = await evaluateAlerts(project, last);
  return { days: days.length, keywords: keywords.length, devices, source: "search-console", site, alerts };
}

/** Job handler for "position-tracking.check". */
export async function runCheck(job: JobRow, ctx: JobContext) {
  const projectId = job.project_id;
  if (!projectId) throw new Error("Missing project.");
  const payload = (job.payload ?? {}) as CheckPayload;
  const [project] = await query<ProjectRow>("SELECT id, owner_id, domain, name FROM projects WHERE id=$1", [projectId]);
  if (!project) return { skipped: "Project was deleted." };
  const campaign = await getCampaign(projectId);
  if (!campaign) return { skipped: "Position Tracking is not set up." };
  if (campaign.source === "demo" && !demoAllowed()) return { skipped: "Demo data is disabled. Switch this campaign to Search Console or DataForSEO in Settings." };

  const live = campaign.source === "dataforseo";
  if (live && !liveEnabled()) throw new Error("DataForSEO credentials are no longer configured; live checks are paused.");
  const all = await query<{ id: string; keyword: string; volume: number | null; metrics_source: string }>(
    "SELECT id, keyword, volume, metrics_source FROM pt_keywords WHERE project_id=$1 ORDER BY created_at, keyword",
    [projectId],
  );
  const only = payload.keywordIds ? new Set(payload.keywordIds) : null;
  const keywords = only ? all.filter((k) => only.has(k.id)) : all;
  if (!keywords.length) return { skipped: "No keywords to check." };
  const devices: Device[] = campaign.device === "both" ? ["desktop", "mobile"] : [campaign.device];
  if (campaign.source === "search-console") return runGscCheck(project, campaign, payload, keywords, devices, ctx);
  const domains = [project.domain, ...campaign.competitors];
  const end = today();
  const historyStart = maxDay(campaign.firstDay ?? addDays(end, -(BACKFILL_DAYS - 1)), addDays(end, -89));

  let days: string[];
  if (live) days = [end];
  else if (payload.backfill) days = daysBetween(addDays(end, -(Math.min(90, payload.backfill) - 1)), end);
  else if (payload.keywordIds || payload.rebuild) days = daysBetween(historyStart, end);
  else if (!campaign.lastDay) days = daysBetween(addDays(end, -(BACKFILL_DAYS - 1)), end);
  else days = daysBetween(maxDay(addDays(campaign.lastDay, 1) > end ? end : addDays(campaign.lastDay, 1), addDays(end, -(BACKFILL_DAYS - 1))), end);
  if (!days.length) days = [end];

  // Live keyword metrics (volume/CPC) for keywords that do not have them yet.
  if (live) {
    await ctx.progress(0, keywords.length * devices.length, "Fetching search volumes");
    await fillVolumes(project.owner_id, campaign.db, keywords);
  }

  const collect = live ? null : demoCollector(campaign.db, project.domain, domains);
  const total = keywords.length * devices.length;
  let done = 0,
    failed = 0;
  let buffer: RankInsert[] = [];
  const serps: { project_id: string; keyword_id: string; device: Device; day: string; results: SerpTop }[] = [];
  await ctx.progress(0, total, days.length > 1 ? `Collecting ${days.length} days of rankings` : "Checking rankings");

  for (const k of keywords) {
    if (await ctx.cancelled()) return { cancelled: true, done };
    for (const device of devices) {
      if (collect) {
        for (const day of days) {
          const { snapshot, top } = collect(k.keyword, device, day);
          buffer.push({ ...snapshot, project_id: projectId, keyword_id: k.id, device, day, source: "demo" });
          if (day === end) serps.push({ project_id: projectId, keyword_id: k.id, device, day, results: top });
        }
      } else {
        try {
          const raw = await liveSerp(project.owner_id, k.keyword, campaign.db, campaign.location, device, end);
          const { snapshot, top } = parseLiveSerp(raw, project.domain, domains);
          buffer.push({ ...snapshot, project_id: projectId, keyword_id: k.id, device, day: end, source: "dataforseo" });
          serps.push({ project_id: projectId, keyword_id: k.id, device, day: end, results: top });
        } catch (e) {
          failed++;
          if (failed >= 5 && failed === done + 1) throw e; // provider unusable: fail fast instead of burning budget
        }
      }
      done++;
    }
    if (buffer.length >= 2500) {
      await flushRankings(buffer);
      buffer = [];
    }
    if (done % Math.max(2, Math.round(total / 40)) === 0 || done === total) await ctx.progress(done, total, `Checked ${done} of ${total} keyword${devices.length > 1 ? "/device pairs" : "s"}`);
  }
  await flushRankings(buffer);
  for (let i = 0; i < serps.length; i += 1000) await flushSerps(serps.slice(i, i + 1000));

  await ctx.progress(total, total, "Updating reports");
  const from = days[0];
  await rebuildDaily(projectId, from, end, devices, domains);
  await updateCampaignDays(projectId, from, end);

  let alerts = 0;
  if (!payload.backfill && !payload.keywordIds && !payload.rebuild) alerts = await evaluateAlerts(project, end);
  return { days: days.length, keywords: keywords.length, devices, source: campaign.source, failed, alerts };
}
