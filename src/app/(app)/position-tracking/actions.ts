"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { query, transaction } from "@/lib/db";
import { AppError, database } from "@/lib/domain";
import { getProject } from "@/lib/projects";
import { liveEnabled } from "@/lib/providers/source";
import { keywordMetrics } from "@/lib/seo/engine";
import { rebuildAllDaily } from "@/lib/position-tracking/check";
import { failure, type ActionResult } from "@/lib/position-tracking/result";
import { cancelCheck, setCheckSchedule, startCheck, type Cadence } from "@/lib/position-tracking/run";
import { cleanCompetitors, cleanEntries, cleanTagName, clearHistory, createCampaign, deleteCampaign, getCampaign, insertKeywords, keywordCount, updateCampaign } from "@/lib/position-tracking/store";
import { BACKFILL_DAYS, MAX_KEYWORDS, type DeviceMode, type KeywordEntry } from "@/lib/position-tracking/types";

const PATH = "/position-tracking";
const entrySchema = z.array(z.object({ keyword: z.string().max(255), tags: z.array(z.string().max(40)).max(20).default([]) })).max(MAX_KEYWORDS * 2);
const deviceSchema = z.enum(["desktop", "mobile", "both"]);
const idList = z.array(z.string().min(1).max(64)).max(MAX_KEYWORDS);

async function owned(projectId: string) {
  const user = await requireUser();
  const project = await getProject(user.id, String(projectId));
  return { user, project };
}
async function ownedCampaign(projectId: string) {
  const ctx = await owned(projectId);
  const campaign = await getCampaign(ctx.project.id);
  if (!campaign) throw new AppError("Set up Position Tracking for this project first.", 404);
  return { ...ctx, campaign };
}
async function assertKeywords(projectId: string, ids: string[]) {
  const rows = await query<{ id: string }>("SELECT id FROM pt_keywords WHERE project_id=$1 AND id IN (SELECT jsonb_array_elements_text($2::jsonb))", [projectId, JSON.stringify(ids)]);
  if (rows.length !== new Set(ids).size) throw new AppError("Some keywords no longer exist. Refresh the page.", 404);
}

export async function setupCampaignAction(
  projectId: string,
  input: { db: string; location: string; device: DeviceMode; competitors: string[]; keywords: KeywordEntry[] },
): Promise<ActionResult<{ jobId: string }>> {
  try {
    const { user, project } = await owned(projectId);
    const device = deviceSchema.parse(input.device);
    const keywords = entrySchema.parse(input.keywords);
    await createCampaign(project, { db: String(input.db), location: String(input.location ?? ""), device, competitors: z.array(z.string().max(255)).max(20).parse(input.competitors), keywords });
    await setCheckSchedule(project.id, "daily");
    const job = await startCheck(user.id, project.id, liveEnabled() ? {} : { backfill: BACKFILL_DAYS });
    revalidatePath(PATH);
    return { ok: true, data: { jobId: job.id } };
  } catch (e) {
    return failure(e);
  }
}

export async function addKeywordsAction(projectId: string, entries: KeywordEntry[]): Promise<ActionResult<{ added: number; jobId: string | null }>> {
  try {
    const { user, project, campaign } = await ownedCampaign(projectId);
    const clean = cleanEntries(entrySchema.parse(entries));
    if (!clean.length) throw new AppError("Enter at least one keyword.");
    const existing = await keywordCount(project.id);
    const known = new Set((await query<{ keyword: string }>("SELECT keyword FROM pt_keywords WHERE project_id=$1", [project.id])).map((r) => r.keyword));
    const fresh = clean.filter((e) => !known.has(e.keyword)).length;
    if (existing + fresh > MAX_KEYWORDS) throw new AppError(`A campaign can track up to ${MAX_KEYWORDS} keywords (${existing} tracked, ${fresh} new).`);
    const ids = await transaction((q) => insertKeywords(q, project.id, campaign.db, campaign.source, clean));
    const job = ids.length ? await startCheck(user.id, project.id, { keywordIds: ids }) : null;
    revalidatePath(PATH);
    return { ok: true, data: { added: ids.length, jobId: job?.id ?? null } };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteKeywordsAction(projectId: string, ids: string[]): Promise<ActionResult<{ deleted: number }>> {
  try {
    const { project } = await ownedCampaign(projectId);
    const list = idList.parse(ids);
    const res = await query("DELETE FROM pt_keywords WHERE project_id=$1 AND id IN (SELECT jsonb_array_elements_text($2::jsonb)) RETURNING id", [project.id, JSON.stringify(list)]);
    await rebuildAllDaily(project.id);
    revalidatePath(PATH);
    return { ok: true, data: { deleted: res.length } };
  } catch (e) {
    return failure(e);
  }
}

export async function runCheckAction(projectId: string): Promise<ActionResult<{ jobId: string }>> {
  try {
    const { user, project } = await ownedCampaign(projectId);
    const job = await startCheck(user.id, project.id, { manual: true });
    revalidatePath(PATH);
    return { ok: true, data: { jobId: job.id } };
  } catch (e) {
    return failure(e);
  }
}

export async function cancelCheckAction(projectId: string, jobId: string): Promise<ActionResult> {
  try {
    const { user } = await ownedCampaign(projectId);
    await cancelCheck(user.id, String(jobId));
    revalidatePath(PATH);
    return { ok: true, data: null };
  } catch (e) {
    return failure(e);
  }
}

// ------------------------------------------------------------------------------------ Tags

export async function createTagAction(projectId: string, name: string): Promise<ActionResult<{ id: string }>> {
  try {
    const { project } = await ownedCampaign(projectId);
    const clean = cleanTagName(String(name));
    const [{ n }] = await query<{ n: number }>("SELECT count(*)::int AS n FROM pt_tags WHERE project_id=$1", [project.id]);
    if (n >= 100) throw new AppError("A campaign can have at most 100 tags.");
    const res = await query<{ id: string }>("INSERT INTO pt_tags(id,project_id,name) VALUES($1,$2,$3) ON CONFLICT(project_id,name) DO NOTHING RETURNING id", [randomUUID(), project.id, clean]);
    if (!res.length) throw new AppError(`A tag named “${clean}” already exists.`, 409);
    revalidatePath(PATH);
    return { ok: true, data: { id: res[0].id } };
  } catch (e) {
    return failure(e);
  }
}

export async function renameTagAction(projectId: string, tagId: string, name: string): Promise<ActionResult> {
  try {
    const { project } = await ownedCampaign(projectId);
    const clean = cleanTagName(String(name));
    const clash = await query("SELECT id FROM pt_tags WHERE project_id=$1 AND name=$2 AND id<>$3", [project.id, clean, tagId]);
    if (clash.length) throw new AppError(`A tag named “${clean}” already exists.`, 409);
    const res = await query("UPDATE pt_tags SET name=$3 WHERE id=$1 AND project_id=$2 RETURNING id", [tagId, project.id, clean]);
    if (!res.length) throw new AppError("Tag not found.", 404);
    revalidatePath(PATH);
    return { ok: true, data: null };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteTagAction(projectId: string, tagId: string): Promise<ActionResult> {
  try {
    const { project } = await ownedCampaign(projectId);
    const res = await query("DELETE FROM pt_tags WHERE id=$1 AND project_id=$2 RETURNING id", [tagId, project.id]);
    if (!res.length) throw new AppError("Tag not found.", 404);
    revalidatePath(PATH);
    return { ok: true, data: null };
  } catch (e) {
    return failure(e);
  }
}

/** Adds or removes a tag on keywords. `tag` is an existing tag id or `{ name }` to create one. */
export async function tagKeywordsAction(projectId: string, keywordIds: string[], tag: { id?: string; name?: string }, mode: "add" | "remove"): Promise<ActionResult<{ tagId: string }>> {
  try {
    const { project } = await ownedCampaign(projectId);
    const ids = idList.parse(keywordIds);
    if (!ids.length) throw new AppError("Select at least one keyword.");
    await assertKeywords(project.id, ids);
    let tagId = tag.id ? String(tag.id) : "";
    if (!tagId) {
      const name = cleanTagName(String(tag.name ?? ""));
      const [row] = await query<{ id: string }>(
        "INSERT INTO pt_tags(id,project_id,name) VALUES($1,$2,$3) ON CONFLICT(project_id,name) DO UPDATE SET name=excluded.name RETURNING id",
        [randomUUID(), project.id, name],
      );
      tagId = row.id;
    } else {
      const [row] = await query("SELECT id FROM pt_tags WHERE id=$1 AND project_id=$2", [tagId, project.id]);
      if (!row) throw new AppError("Tag not found.", 404);
    }
    if (mode === "add")
      await query("INSERT INTO pt_keyword_tags(keyword_id,tag_id) SELECT value, $2 FROM jsonb_array_elements_text($1::jsonb) ON CONFLICT DO NOTHING", [JSON.stringify(ids), tagId]);
    else await query("DELETE FROM pt_keyword_tags WHERE tag_id=$2 AND keyword_id IN (SELECT jsonb_array_elements_text($1::jsonb))", [JSON.stringify(ids), tagId]);
    revalidatePath(PATH);
    return { ok: true, data: { tagId } };
  } catch (e) {
    return failure(e);
  }
}

// ------------------------------------------------------------------------------------ Campaign settings

export async function updateCampaignAction(
  projectId: string,
  input: { db: string; location: string; device: DeviceMode; competitors: string[] },
): Promise<ActionResult<{ jobId: string | null; reset: boolean }>> {
  try {
    const { user, project, campaign } = await ownedCampaign(projectId);
    const db = database(String(input.db)).code;
    const location = String(input.location ?? "").trim().slice(0, 120);
    const device = deviceSchema.parse(input.device);
    const competitors = cleanCompetitors(z.array(z.string().max(255)).max(20).parse(input.competitors), project.domain);
    const targetingChanged = db !== campaign.db || location !== campaign.location;
    const oldDevices = campaign.device === "both" ? ["desktop", "mobile"] : [campaign.device];
    const newDevices = device === "both" ? ["desktop", "mobile"] : [device];
    const addedDevice = newDevices.some((d) => !oldDevices.includes(d));
    const competitorsChanged = competitors.join("|") !== campaign.competitors.join("|");
    if (!targetingChanged && !competitorsChanged && device === campaign.device) return { ok: true, data: { jobId: null, reset: false } };

    await updateCampaign(project.id, { db, location, device, competitors });
    let jobId: string | null = null;
    if (targetingChanged) {
      // A different market is a different dataset: start the history over so markets never mix.
      await clearHistory(project.id);
      if (db !== campaign.db && campaign.source === "demo") {
        const kws = await query<{ id: string; keyword: string }>("SELECT id, keyword FROM pt_keywords WHERE project_id=$1", [project.id]);
        const rows = kws.map((k) => {
          const m = keywordMetrics(k.keyword, db);
          return { id: k.id, volume: m.volume, cpc: m.cpc, kd: m.kd, intents: m.intents };
        });
        await query("UPDATE pt_keywords k SET volume=x.volume, cpc=x.cpc, kd=x.kd, intents=x.intents FROM jsonb_to_recordset($1::jsonb) AS x(id text, volume int, cpc real, kd int, intents jsonb) WHERE k.id=x.id", [JSON.stringify(rows)]);
      } else if (db !== campaign.db) await query("UPDATE pt_keywords SET metrics_source='pending' WHERE project_id=$1", [project.id]);
      jobId = (await startCheck(user.id, project.id, campaign.source === "demo" ? { backfill: BACKFILL_DAYS } : {})).id;
    } else {
      const removed = oldDevices.filter((d) => !newDevices.includes(d));
      for (const d of removed) {
        await query("DELETE FROM pt_rankings WHERE project_id=$1 AND device=$2", [project.id, d]);
        await query("DELETE FROM pt_daily WHERE project_id=$1 AND device=$2", [project.id, d]);
        await query("DELETE FROM pt_serps WHERE project_id=$1 AND device=$2", [project.id, d]);
      }
      if (campaign.source === "demo" && (addedDevice || competitorsChanged)) jobId = (await startCheck(user.id, project.id, { rebuild: true })).id;
      else if (addedDevice || competitorsChanged) {
        await rebuildAllDaily(project.id);
        jobId = (await startCheck(user.id, project.id, { manual: true })).id;
      }
    }
    revalidatePath(PATH);
    return { ok: true, data: { jobId, reset: targetingChanged } };
  } catch (e) {
    return failure(e);
  }
}

export async function addCompetitorAction(projectId: string, domain: string): Promise<ActionResult<{ jobId: string | null }>> {
  try {
    const { campaign } = await ownedCampaign(projectId);
    const res = await updateCampaignAction(projectId, { db: campaign.db, location: campaign.location, device: campaign.device, competitors: [...campaign.competitors, String(domain)] });
    if (!res.ok) return res;
    return { ok: true, data: { jobId: res.data.jobId } };
  } catch (e) {
    return failure(e);
  }
}

export async function setScheduleAction(projectId: string, cadence: Cadence): Promise<ActionResult> {
  try {
    const { project } = await ownedCampaign(projectId);
    if (!["daily", "weekly", "off"].includes(cadence)) throw new AppError("Invalid schedule.");
    await setCheckSchedule(project.id, cadence);
    revalidatePath(PATH);
    return { ok: true, data: null };
  } catch (e) {
    return failure(e);
  }
}

/** Demo campaign → live DataForSEO data. Clears demo history so demo and live numbers never mix. */
export async function switchToLiveAction(projectId: string): Promise<ActionResult<{ jobId: string }>> {
  try {
    const { user, project, campaign } = await ownedCampaign(projectId);
    if (!liveEnabled()) throw new AppError("Connect DataForSEO in Settings first.");
    if (campaign.source === "dataforseo") throw new AppError("This campaign already uses live data.");
    await clearHistory(project.id);
    await query("UPDATE pt_keywords SET volume=NULL, cpc=NULL, kd=NULL, intents='[]'::jsonb, metrics_source='pending' WHERE project_id=$1", [project.id]);
    await updateCampaign(project.id, { source: "dataforseo" });
    const job = await startCheck(user.id, project.id, {});
    revalidatePath(PATH);
    return { ok: true, data: { jobId: job.id } };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteCampaignAction(projectId: string): Promise<ActionResult> {
  try {
    const { project } = await ownedCampaign(projectId);
    await deleteCampaign(project.id);
    revalidatePath(PATH);
    return { ok: true, data: null };
  } catch (e) {
    return failure(e);
  }
}

/** Keyword suggestions for the setup wizard / add-keywords dialog (demo engine only; empty in live mode). */
export async function keywordSuggestionsAction(projectId: string, db: string): Promise<ActionResult<{ keyword: string; position: number; volume: number; kd: number }[]>> {
  try {
    const { project } = await owned(projectId);
    if (liveEnabled()) return { ok: true, data: [] };
    const { domainKeywords } = await import("@/lib/seo/engine");
    const rows = domainKeywords(project.domain, database(db).code)
      .slice(0, 150)
      .map((k) => ({ keyword: k.keyword, position: k.position, volume: k.metrics.volume, kd: k.metrics.kd }));
    return { ok: true, data: rows };
  } catch (e) {
    return failure(e);
  }
}
