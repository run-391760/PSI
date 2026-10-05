import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { fetchProfileFeed } from "@/lib/cx/listening/connectors";
import { prepareMentions, storeMentions } from "@/lib/cx/listening/ingest";
import type { ListenSource } from "@/lib/cx/listening/sources";
import { audit } from "./audit";
import { colorFor, isHexColor, parseSocialHandle, profileFetchable, socialNetwork, SOCIAL_RELATIONS } from "./pure/settings";
import { iso } from "./util";

/**
 * More Social Profiles: public profiles tracked without login (competitors, partners, influencers).
 * Profiles on networks with a free public feed are fetched with every listening run and stored as mentions
 * (linked through cx_settings_profile_mentions); the rest are stored and marked as needing that network's API.
 */
export type SocialProfile = {
  id: string;
  network: string;
  handle: string;
  name: string;
  url: string;
  relation: string;
  color: string;
  active: boolean;
  posts: number;
  lastFetchedAt: string | null;
  lastError: string | null;
  creator: string | null;
  createdAt: string;
  fetchable: boolean;
  needs: string | null;
};

const keys = () => ({ reddit: !!process.env.REDDIT_CLIENT_ID && !!process.env.REDDIT_CLIENT_SECRET, youtubeKey: !!process.env.YOUTUBE_API_KEY });

export async function listSocialProfiles(projectId: string): Promise<SocialProfile[]> {
  const rows = await query<{ id: string; network: string; handle: string; name: string; url: string; relation: string; color: string; active: boolean; posts: number; last_fetched_at: string | null; last_error: string | null; creator: string | null; created_at: string; external_id: string }>(
    `SELECT s.id,s.network,s.handle,s.name,s.url,s.relation,s.color,s.active,s.external_id,
            (SELECT count(*)::int FROM cx_settings_profile_mentions pm WHERE pm.profile_id=s.id) AS posts,
            s.last_fetched_at,s.last_error,COALESCE(NULLIF(u.name,''),u.email) AS creator,s.created_at
       FROM cx_settings_social_profiles s LEFT JOIN users u ON u.id=s.created_by WHERE s.project_id=$1 ORDER BY s.network, lower(s.name)`,
    [projectId],
  );
  const k = keys();
  return rows.map((r) => {
    const f = profileFetchable(r.network, k, r.external_id || r.handle);
    return {
      id: r.id, network: r.network, handle: r.handle, name: r.name, url: r.url, relation: r.relation, color: isHexColor(r.color) ? r.color : colorFor(r.id), active: r.active,
      posts: r.posts, lastFetchedAt: iso(r.last_fetched_at), lastError: r.last_error, creator: r.creator, createdAt: iso(r.created_at)!, fetchable: f.ok, needs: f.reason,
    };
  });
}

export type SocialProfileInput = { network: string; handle: string; name?: string; relation?: string; color?: string };

export async function saveSocialProfile(projectId: string, actor: { id: string; name: string }, input: SocialProfileInput & { id?: string }) {
  const net = socialNetwork(input.network);
  if (!net) throw new AppError("Choose a network.");
  const h = parseSocialHandle(input.network, input.handle);
  if (!h.ok) throw new AppError(h.error);
  const relation = SOCIAL_RELATIONS.some((r) => r.id === input.relation) ? input.relation! : "competitor";
  const color = input.color && isHexColor(input.color) ? input.color.toLowerCase() : "";
  const name = String(input.name ?? "").trim().slice(0, 80) || h.handle;
  const [dupe] = await query("SELECT 1 FROM cx_settings_social_profiles WHERE project_id=$1 AND network=$2 AND lower(handle)=lower($3) AND id<>$4", [projectId, input.network, h.handle, input.id ?? ""]);
  if (dupe) throw new AppError("That profile is already tracked.");
  if (input.id) {
    const r = await query("UPDATE cx_settings_social_profiles SET network=$3,handle=$4,url=$5,name=$6,relation=$7,color=$8,external_id=CASE WHEN handle=$4 THEN external_id ELSE '' END WHERE id=$1 AND project_id=$2 RETURNING id", [input.id, projectId, input.network, h.handle, h.url, name, relation, color]);
    if (!r.length) throw new AppError("Profile not found.", 404);
    return input.id;
  }
  const [{ n }] = await query<{ n: number }>("SELECT count(*)::int n FROM cx_settings_social_profiles WHERE project_id=$1", [projectId]);
  if (n >= 200) throw new AppError("A brand can track up to 200 public profiles.");
  const id = randomUUID();
  await query("INSERT INTO cx_settings_social_profiles(id,project_id,network,handle,url,name,relation,color,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, projectId, input.network, h.handle, h.url, name, relation, color, actor.id]);
  await audit(projectId, actor, "profile.track", `${net.name}: ${h.handle}`);
  return id;
}

export async function setSocialProfileActive(projectId: string, id: string, active: boolean) {
  const r = await query("UPDATE cx_settings_social_profiles SET active=$3 WHERE id=$1 AND project_id=$2 RETURNING id", [id, projectId, active]);
  if (!r.length) throw new AppError("Profile not found.", 404);
}

export async function deleteSocialProfile(projectId: string, actor: { id: string; name: string }, id: string) {
  const [r] = await query<{ handle: string }>("DELETE FROM cx_settings_social_profiles WHERE id=$1 AND project_id=$2 RETURNING handle", [id, projectId]);
  if (r) await audit(projectId, actor, "profile.untrack", r.handle);
}

const NO_FILTER = { keywords: [], excluded: [], languages: [] };

/** Fetch one tracked profile's latest posts into mentions. */
export async function fetchSocialProfile(projectId: string, id: string) {
  const [p] = await query<{ id: string; network: string; handle: string; external_id: string }>("SELECT id,network,handle,external_id FROM cx_settings_social_profiles WHERE id=$1 AND project_id=$2", [id, projectId]);
  if (!p) throw new AppError("Profile not found.", 404);
  const f = profileFetchable(p.network, keys(), p.external_id || p.handle);
  if (!f.ok) throw new AppError(f.reason ?? "This network needs its API.");
  const source = socialNetwork(p.network)!.source as ListenSource;
  try {
    const { posts, externalId } = await fetchProfileFeed(p.network, p.handle, p.external_id);
    // Profile feeds are the author's own posts: no keyword matching, every post is kept.
    const rows = prepareMentions(posts, NO_FILTER, source, { keepAll: true });
    const { inserted, ids } = await storeMentions(projectId, null, source, rows);
    for (const mid of ids) await query("INSERT INTO cx_settings_profile_mentions(profile_id,mention_id,project_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [p.id, mid, projectId]);
    await query("UPDATE cx_settings_social_profiles SET last_fetched_at=now(), last_error=NULL, external_id=$2 WHERE id=$1", [p.id, externalId.slice(0, 200)]);
    return { fetched: rows.length, inserted };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await query("UPDATE cx_settings_social_profiles SET last_fetched_at=now(), last_error=$2 WHERE id=$1", [p.id, msg]);
    throw new AppError(msg);
  }
}

/** Called by the listening fetch job: every active, fetchable profile of the brand. */
export async function ingestSocialProfiles(projectId: string) {
  const list = (await listSocialProfiles(projectId)).filter((p) => p.active && p.fetchable);
  let inserted = 0;
  for (const p of list) {
    try {
      inserted += (await fetchSocialProfile(projectId, p.id)).inserted;
    } catch {
      // error stored on the profile row
    }
  }
  return { profiles: list.length, inserted };
}
