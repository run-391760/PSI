/**
 * A/B testing (CX ops, server-only). A test is two posts created through the publishing module (same
 * channels, same time, distinct UTM content "variant-a"/"variant-b"); each gets its own tracked short
 * links per channel, and real clicks on them (bots excluded) decide the winner with abWinner().
 * Publishing is never restructured here: posts are created with savePost and moved with transition.
 */
import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { AppError } from "@/lib/domain";
import { pubChannel, type ChannelResult, type PostStatus, type PubChannel } from "@/lib/cx/publishing/core";
import { connections, deletePost, getSettings, postText, savePost, shortUrl, transition, type Access, type Connection, type PostRow } from "@/lib/cx/publishing/data";
import { channelInsights } from "@/lib/cx/publishing/dispatch";
import { abWinner } from "./model";
import { cleanAbInput, dailyVariantSeries, effectiveStatus, engagementFor, statusLabel, variantBody, variantUtm, type AbInput, type AbStatus, type AbWinner, type Engagement, type RecentLite, type Variant } from "./ab-model";

type User = { id: string; name: string; email: string };
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

type TestRow = {
  id: string; project_id: string; name: string; hypothesis: string; channels: PubChannel[]; link_url: string | null;
  post_a_id: string | null; post_b_id: string | null; metric: string; min_clicks: number; confidence: number;
  status: string; winner: AbWinner; started_at: string | null; ends_at: string | null; decided_at: string | null;
  created_by: string | null; created_by_name: string | null; created_at: string; updated_at: string;
};

type PostLite = { id: string; status: PostStatus; scheduled_at: string | null; published_at: string | null; results: Record<string, ChannelResult> };

export type AbListItem = {
  id: string; name: string; hypothesis: string; channels: PubChannel[]; status: AbStatus; label: string; expired: boolean; notStarted: boolean;
  winner: AbWinner; leader: Variant | null; significant: boolean; clicksA: number | null; clicksB: number | null;
  startedAt: string | null; endsAt: string | null; createdAt: string; createdBy: string | null; postsMissing: boolean;
};

const SELECT = `SELECT t.*, COALESCE(NULLIF(u.name,''),u.email) created_by_name FROM cx_ops_ab_tests t LEFT JOIN users u ON u.id=t.created_by`;

function normRow(r: TestRow): TestRow {
  return {
    ...r,
    channels: Array.isArray(r.channels) ? r.channels : [],
    confidence: Math.round(Number(r.confidence) * 1000) / 1000,
    started_at: iso(r.started_at), ends_at: iso(r.ends_at), decided_at: iso(r.decided_at), created_at: iso(r.created_at)!, updated_at: iso(r.updated_at)!,
  };
}
const normPost = (p: PostLite | undefined | null): PostLite | null =>
  p ? { id: p.id, status: p.status, scheduled_at: iso(p.scheduled_at), published_at: iso(p.published_at), results: p.results ?? {} } : null;

/** Tracked clicks (bots excluded) on each of the test's posts, counted until the test's end time. */
async function clickTotals(projectId: string, testIds: string[]) {
  if (!testIds.length) return new Map<string, number>();
  const rows = await query<{ test_id: string; post_id: string; clicks: number }>(
    `SELECT t.id test_id, l.post_id, count(k.id)::int clicks
     FROM cx_ops_ab_tests t
     JOIN cx_pub_links l ON l.project_id=t.project_id AND l.post_id IN (t.post_a_id, t.post_b_id)
     JOIN cx_pub_clicks k ON k.link_id=l.id AND k.device<>'bot' AND (t.ends_at IS NULL OR k.clicked_at <= t.ends_at)
     WHERE t.project_id=$1 AND t.id = ANY($2::text[]) GROUP BY 1,2`,
    [projectId, testIds],
  );
  return new Map(rows.map((r) => [`${r.test_id}:${r.post_id}`, r.clicks]));
}

function summarize(t: TestRow, a: PostLite | null, b: PostLite | null, clicksA: number | null, clicksB: number | null) {
  const eff = effectiveStatus(t, a, b);
  const w = abWinner(clicksA ?? 0, clicksB ?? 0, { minClicks: t.min_clicks, confidence: t.confidence });
  return { eff, w };
}

export async function listTests(projectId: string): Promise<AbListItem[]> {
  const tests = (await query<TestRow>(`${SELECT} WHERE t.project_id=$1 ORDER BY t.created_at DESC LIMIT 500`, [projectId])).map(normRow);
  if (!tests.length) return [];
  const ids = tests.flatMap((t) => [t.post_a_id, t.post_b_id]).filter((x): x is string => !!x);
  const posts = ids.length ? await query<PostLite>("SELECT id,status,scheduled_at,published_at,results FROM cx_pub_posts WHERE project_id=$1 AND id = ANY($2::text[])", [projectId, ids]) : [];
  const clicks = await clickTotals(projectId, tests.map((t) => t.id));
  return tests.map((t) => {
    const a = normPost(posts.find((p) => p.id === t.post_a_id));
    const b = normPost(posts.find((p) => p.id === t.post_b_id));
    const ca = a ? clicks.get(`${t.id}:${a.id}`) ?? 0 : null;
    const cb = b ? clicks.get(`${t.id}:${b.id}`) ?? 0 : null;
    const { eff, w } = summarize(t, a, b, ca, cb);
    return {
      id: t.id, name: t.name, hypothesis: t.hypothesis, channels: t.channels, status: eff.status, label: statusLabel(eff, t.winner), expired: eff.expired, notStarted: eff.notStarted,
      winner: t.winner, leader: w.leader, significant: w.significant, clicksA: ca, clicksB: cb,
      startedAt: eff.startedAt, endsAt: t.ends_at, createdAt: t.created_at, createdBy: t.created_by_name, postsMissing: !a || !b,
    };
  });
}

async function testRow(projectId: string, id: string) {
  const [t] = await query<TestRow>(`${SELECT} WHERE t.id=$1 AND t.project_id=$2`, [id, projectId]);
  if (!t) throw new AppError("A/B test not found.", 404);
  return normRow(t);
}

export type VariantDetail = {
  variant: Variant;
  post: null | {
    id: string; title: string; status: PostStatus; text: string; scheduledAt: string | null; publishedAt: string | null;
    channels: { kind: PubChannel; name: string; result: ChannelResult | null; short: string | null; code: string | null; target: string | null; clicks: number }[];
  };
  clicks: number | null;
  engagement: Engagement | null;
};

export type AbDetail = {
  test: Omit<TestRow, "project_id" | "created_by"> ;
  status: AbStatus; startedAt: string | null; expired: boolean; notStarted: boolean;
  variants: [VariantDetail, VariantDetail];
  result: ReturnType<typeof abWinner>;
  series: { day: string; a: number; b: number }[];
  connections: Connection[];
  requireApproval: boolean;
  insightsChecked: boolean;
};

export async function getTest(projectId: string, id: string, origin: string): Promise<AbDetail> {
  const t = await testRow(projectId, id);
  const postIds = [t.post_a_id, t.post_b_id].filter((x): x is string => !!x);
  const [posts, links, conns, settings] = await Promise.all([
    postIds.length ? query<PostRow>("SELECT * FROM cx_pub_posts WHERE project_id=$1 AND id = ANY($2::text[])", [projectId, postIds]) : Promise.resolve([] as PostRow[]),
    postIds.length
      ? query<{ id: string; code: string; channel: string | null; target_url: string; post_id: string; clicks: number }>(
          `SELECT l.id,l.code,l.channel,l.target_url,l.post_id,
             count(k.id) FILTER (WHERE k.device<>'bot' AND ($3::timestamptz IS NULL OR k.clicked_at <= $3))::int clicks
           FROM cx_pub_links l LEFT JOIN cx_pub_clicks k ON k.link_id=l.id
           WHERE l.project_id=$1 AND l.post_id = ANY($2::text[]) GROUP BY l.id`,
          [projectId, postIds, t.ends_at],
        )
      : Promise.resolve([]),
    connections(projectId),
    getSettings(projectId),
  ]);
  const daily = postIds.length
    ? await query<{ post_id: string; day: string; clicks: number }>(
        `SELECT l.post_id, to_char(date_trunc('day', k.clicked_at AT TIME ZONE 'UTC'),'YYYY-MM-DD') AS day, count(*)::int clicks
         FROM cx_pub_clicks k JOIN cx_pub_links l ON l.id=k.link_id
         WHERE l.project_id=$1 AND l.post_id = ANY($2::text[]) AND k.device<>'bot' AND ($3::timestamptz IS NULL OR k.clicked_at <= $3)
         GROUP BY 1,2 ORDER BY 2`,
        [projectId, postIds, t.ends_at],
      )
    : [];

  const pa = posts.find((p) => p.id === t.post_a_id) ?? null;
  const pb = posts.find((p) => p.id === t.post_b_id) ?? null;
  const eff = effectiveStatus(t, normPost(pa), normPost(pb));

  // Engagement only from connected networks' real insights (no API → null = n/a).
  const connectedKinds = new Set(conns.filter((c) => c.connected).map((c) => c.kind));
  const needInsights = t.channels.some((k) => connectedKinds.has(k)) && [pa, pb].some((p) => p && Object.values(p.results ?? {}).some((r) => r?.status === "published" && r.externalId));
  const recentByKind: Record<string, RecentLite[]> = {};
  if (needInsights) {
    for (const r of await channelInsights(projectId).catch(() => [])) if (r.stats) recentByKind[r.kind] = r.stats.recent;
  }

  const variant = (v: Variant, p: PostRow | null): VariantDetail => {
    if (!p) return { variant: v, post: null, clicks: null, engagement: null };
    const own = links.filter((l) => l.post_id === p.id);
    const chans = p.channels.map((kind) => {
      const l = own.find((x) => x.channel === kind) ?? null;
      return { kind, name: pubChannel(kind)?.name ?? kind, result: p.results?.[kind] ?? null, short: l ? shortUrl(p.origin ?? origin, l.code) : null, code: l?.code ?? null, target: l?.target_url ?? null, clicks: l?.clicks ?? 0 };
    });
    const results = Object.fromEntries(p.channels.filter((k) => connectedKinds.has(k)).map((k) => [k, p.results?.[k]]));
    const eng = needInsights ? engagementFor(results, recentByKind) : null;
    return {
      variant: v,
      post: { id: p.id, title: p.title, status: p.status, text: postText(p, p.channels[0] ?? ""), scheduledAt: iso(p.scheduled_at), publishedAt: iso(p.published_at), channels: chans },
      clicks: own.reduce((s, l) => s + l.clicks, 0),
      engagement: eng && eng.matched ? eng : null,
    };
  };
  const va = variant("a", pa);
  const vb = variant("b", pb);
  const result = abWinner(va.clicks ?? 0, vb.clicks ?? 0, { minClicks: t.min_clicks, confidence: t.confidence });
  const rows = daily.map((d) => ({ day: d.day, variant: (d.post_id === t.post_a_id ? "a" : "b") as Variant, clicks: d.clicks }));
  const now = new Date().toISOString();
  const startIso = eff.startedAt && eff.startedAt < now ? eff.startedAt : t.created_at;
  const firstDay = [startIso.slice(0, 10), ...(rows[0] ? [rows[0].day] : [])].sort()[0];
  const series = dailyVariantSeries(rows, firstDay, t.ends_at && t.ends_at < now ? t.ends_at : now);
  const { project_id: _p, created_by: _c, ...test } = t;
  return {
    test, status: eff.status, startedAt: eff.startedAt, expired: eff.expired, notStarted: eff.notStarted,
    variants: [va, vb], result, series, connections: conns, requireApproval: settings.requireApproval, insightsChecked: needInsights,
  };
}

// ---------------------------------------------------------------- mutations

export type CreateResult = { id: string; pendingApproval: boolean; mode: AbInput["mode"] };

/** Create both variant posts (savePost), move them per the chosen mode (transition), store the test. */
export async function createTest(access: Access, user: User, input: AbInput, origin: string): Promise<CreateResult> {
  const c = cleanAbInput(input, Date.now(), origin.length);
  if (!c.ok) throw new AppError(c.error);
  const v = c.value;
  const { requireApproval } = await getSettings(access.brand.id);
  const post = (variant: Variant, text: string) =>
    savePost(access, user.id, {
      title: `${v.name} · ${variant.toUpperCase()}`,
      body: variantBody(text),
      variants: {},
      channels: v.channels,
      media: [],
      firstComment: "",
      linkUrl: v.linkUrl,
      utm: variantUtm(v.name, variant),
      campaignId: null,
      approverId: null,
      scheduledAt: v.mode === "schedule" ? v.scheduleAt : null,
      postType: "text",
    }, origin);
  const created: string[] = [];
  let pendingApproval = false;
  try {
    created.push(await post("a", v.textA));
    created.push(await post("b", v.textB));
    if (v.mode !== "draft") {
      if (requireApproval) {
        for (const id of created) await transition(access, user, id, "submit", `A/B test “${v.name}”: please approve both variants together so they go live at the same time.`);
        pendingApproval = true;
      } else if (v.mode === "schedule") {
        for (const id of created) await transition(access, user, id, "schedule", "", v.scheduleAt!);
      } else {
        // Both variants go out in the same dispatcher run = equal exposure.
        for (const id of created) await transition(access, user, id, "publish_now", "");
      }
    }
  } catch (e) {
    for (const id of created) await deletePost(access.brand.id, id).catch(() => {});
    throw e;
  }
  const running = v.mode !== "draft" && !pendingApproval;
  const id = randomUUID();
  await query(
    `INSERT INTO cx_ops_ab_tests(id,project_id,name,hypothesis,channels,link_url,post_a_id,post_b_id,metric,min_clicks,confidence,status,started_at,ends_at,created_by)
     VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,'clicks',$9,$10,$11,$12,$13,$14)`,
    [id, access.brand.id, v.name, v.hypothesis, JSON.stringify(v.channels), v.linkUrl, created[0], created[1], v.minClicks, v.confidence, running ? "running" : "draft", running ? (v.scheduleAt ?? new Date().toISOString()) : null, v.endsAt, user.id],
  );
  return { id, pendingApproval, mode: v.mode };
}

/** Start a draft test: publish now / schedule both variant posts (or submit them for approval). */
export async function startTest(access: Access, user: User, id: string, mode: "publish" | "schedule", at: string | null) {
  const t = await testRow(access.brand.id, id);
  if (t.status === "completed") throw new AppError("The test has ended.");
  if (!t.post_a_id || !t.post_b_id) throw new AppError("A variant post was deleted; create a new test.");
  const { requireApproval } = await getSettings(access.brand.id);
  const posts = await query<{ id: string; status: PostStatus }>("SELECT id,status FROM cx_pub_posts WHERE id = ANY($1::text[]) AND project_id=$2", [[t.post_a_id, t.post_b_id], access.brand.id]);
  if (posts.length < 2) throw new AppError("A variant post was deleted; create a new test.");
  const when = mode === "schedule" ? new Date(at ?? "") : new Date();
  if (Number.isNaN(when.getTime())) throw new AppError("Pick a date and time.");
  if (mode === "schedule" && when.getTime() < Date.now() - 60_000) throw new AppError("The time is in the past.");
  if (t.ends_at && Date.parse(t.ends_at) <= when.getTime()) throw new AppError("The test's end date is before that start time.");
  if (requireApproval && posts.some((p) => !["approved", "scheduled", "failed"].includes(p.status))) {
    for (const p of posts) {
      if (["draft", "failed"].includes(p.status)) {
        if (mode === "schedule") await query("UPDATE cx_pub_posts SET scheduled_at=$2, updated_at=now() WHERE id=$1", [p.id, when.toISOString()]);
        await transition(access, user, p.id, "submit", `A/B test “${t.name}”: please approve both variants together.`);
      }
    }
    return { pendingApproval: true };
  }
  for (const p of posts) if (p.status !== "published") await transition(access, user, p.id, mode === "schedule" ? "schedule" : "publish_now", "", mode === "schedule" ? when.toISOString() : undefined);
  await query("UPDATE cx_ops_ab_tests SET status='running', started_at=$3, updated_at=now() WHERE id=$1 AND project_id=$2", [id, access.brand.id, when.toISOString()]);
  return { pendingApproval: false };
}

async function frozenCounts(projectId: string, t: TestRow) {
  const m = await clickTotals(projectId, [t.id]);
  return { a: t.post_a_id ? m.get(`${t.id}:${t.post_a_id}`) ?? 0 : 0, b: t.post_b_id ? m.get(`${t.id}:${t.post_b_id}`) ?? 0 : 0 };
}

/** Declare the winner: the significant leader (checked again on the server), or "none". Ends the test. */
export async function declareWinner(projectId: string, id: string, choice: "winner" | "none") {
  const t = await testRow(projectId, id);
  let winner: "a" | "b" | "none" = "none";
  if (choice === "winner") {
    const c = await frozenCounts(projectId, t);
    const r = abWinner(c.a, c.b, { minClicks: t.min_clicks, confidence: t.confidence });
    if (!r.significant || !r.winner) throw new AppError(`No significant winner yet. ${r.reason}`);
    winner = r.winner;
  }
  await query(
    `UPDATE cx_ops_ab_tests SET winner=$3, status='completed', decided_at=now(),
       ends_at=CASE WHEN ends_at IS NULL OR ends_at > now() THEN now() ELSE ends_at END, updated_at=now()
     WHERE id=$1 AND project_id=$2`,
    [id, projectId, winner],
  );
  return winner;
}

/** Stop counting clicks now and mark the test completed (the winner can still be declared on the frozen counts). */
export async function endTest(projectId: string, id: string) {
  const t = await testRow(projectId, id);
  if (t.status === "completed") throw new AppError("The test has already ended.");
  await query(
    `UPDATE cx_ops_ab_tests SET status='completed', started_at=COALESCE(started_at, now()),
       ends_at=CASE WHEN ends_at IS NULL OR ends_at > now() THEN now() ELSE ends_at END, updated_at=now()
     WHERE id=$1 AND project_id=$2`,
    [id, projectId],
  );
}

/** Delete the test record only (its two posts and their links stay in Publishing). */
export async function deleteTest(projectId: string, id: string) {
  await testRow(projectId, id);
  await query("DELETE FROM cx_ops_ab_tests WHERE id=$1 AND project_id=$2", [id, projectId]);
}
