"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, type ActionResult } from "@/lib/content/action";
import { AppError, database } from "@/lib/domain";
import { aiBrief, aiFix, aiReview, type AiProposal } from "@/lib/optimizer/ai";
import { STATUS_LABEL, summarize } from "@/lib/optimizer/analyze";
import { briefToMarkdown, researchBrief } from "@/lib/optimizer/brief";
import { applyFix } from "@/lib/optimizer/fixes";
import { checkLinks, checkLive, importPage, loadSitemap, researchInputOf, runResearch } from "@/lib/optimizer/research";
import {
  addRevision,
  bodyHash,
  createDraft,
  deleteDraft,
  draftPatch,
  duplicateDraft,
  getBrief,
  getBundle,
  getDraft,
  inputOf,
  linkBrief,
  maybeEditRevision,
  reportFor,
  revisionSnapshot,
  saveBrief,
  saveBundle,
  setStatus,
  updateDraft,
  type DraftPatch,
} from "@/lib/optimizer/store";
import type { Brief, Fix, ReportSummary } from "@/lib/optimizer/types";

/** Server actions of the AI Pre-Publish SEO & Content Optimizer (every action checks ownership via the store). */

const PATH = "/optimizer";
const done = () => revalidatePath(PATH, "layout");
const id = z.string().min(1).max(64);

const position = z.union([z.enum(["start", "after-h1", "after-intro", "before-conclusion", "end"]), z.object({ afterHeading: z.string().max(300) })]);
const fixSchema: z.ZodType<Fix> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("set"), field: z.enum(["title", "metaDescription", "slug", "url", "keyword"]), value: z.string().max(500) }),
    z.object({ kind: z.literal("meta"), patch: draftPatch.shape.meta.unwrap() }),
    z.object({ kind: z.literal("replace"), find: z.string().max(60_000), replace: z.string().max(60_000), all: z.boolean().optional(), last: z.boolean().optional() }),
    z.object({ kind: z.literal("insert"), markdown: z.string().max(60_000), position }),
    z.object({ kind: z.literal("set-h1"), text: z.string().max(300) }),
    z.object({ kind: z.literal("link"), phrase: z.string().max(200), url: z.string().max(1000) }),
    z.object({ kind: z.literal("alt"), src: z.string().max(2000), alt: z.string().max(200) }),
    z.object({ kind: z.literal("batch"), fixes: z.array(fixSchema).max(100) }),
  ]),
) as z.ZodType<Fix>;

export type ScoreChange = { before: number | null; after: number | null; summary: ReportSummary; notes: string[]; status: string };

const createInput = z.object({
  keyword: z.string().trim().min(1, "Enter the primary keyword.").max(120),
  title: z.string().trim().max(300).optional(),
  body: z.string().max(200_000).optional(),
  url: z.string().trim().max(500).optional(),
  importUrl: z.string().trim().max(500).optional(),
  db: z.string().max(4).optional(),
  competitors: z.array(z.string().trim().max(500)).max(10).optional(),
});

export async function createDraftAction(raw: z.input<typeof createInput>): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const input = createInput.parse(raw);
    const db = database(input.db ?? "US").code;
    let draft;
    if (input.importUrl) {
      const page = await importPage(input.importUrl);
      draft = await createDraft(user.id, {
        keyword: input.keyword,
        title: input.title || page.title,
        metaDescription: page.metaDescription,
        url: input.url || page.url,
        slug: page.slug,
        body: page.body,
        meta: { db, canonical: page.canonical, robots: page.robots, schema: page.schema || undefined, competitors: input.competitors },
      });
    } else draft = await createDraft(user.id, { keyword: input.keyword, title: input.title ?? "", body: input.body ?? "", url: input.url ?? "", meta: { db, competitors: input.competitors, robots: "index, follow" } });
    done();
    return { ok: true, data: { id: draft.id } };
  } catch (e) {
    return fail(e);
  }
}

/** Autosave: persists fields, re-scores, and folds edits into one revision per 10 minutes. */
export async function saveDraftAction(draftId: string, patch: DraftPatch): Promise<ActionResult<{ updatedAt: string; summary: ReportSummary }>> {
  try {
    const user = await requireUser();
    const { draft, report } = await updateDraft(user.id, id.parse(draftId), patch);
    await maybeEditRevision(user.id, draft, report);
    return { ok: true, data: { updatedAt: draft.updatedAt, summary: summarize(report) } };
  } catch (e) {
    return fail(e);
  }
}

export async function updateSettingsAction(draftId: string, patch: DraftPatch, note = "Updated article settings"): Promise<ActionResult<ScoreChange>> {
  try {
    const user = await requireUser();
    const before = await getDraft(user.id, id.parse(draftId));
    const { report } = await updateDraft(user.id, before.id, patch, { note: note.slice(0, 120), kind: "edit" });
    done();
    return { ok: true, data: { before: before.score, after: report.overall, summary: summarize(report), notes: [], status: STATUS_LABEL[report.status] } };
  } catch (e) {
    return fail(e);
  }
}

/** One-click apply & re-score: applies an approved fix, records a revision and returns before/after. */
export async function applyFixAction(draftId: string, rawFix: Fix, label: string): Promise<ActionResult<ScoreChange>> {
  try {
    const user = await requireUser();
    const draft = await getDraft(user.id, id.parse(draftId));
    const before = await reportFor(user.id, draft);
    const r = applyFix(inputOf(draft), fixSchema.parse(rawFix));
    if (!r.changed) throw new AppError(r.notes[0] ?? "This fix no longer applies to the current draft.");
    const { report } = await updateDraft(user.id, draft.id, r.draft, { note: `Applied: ${label}`.slice(0, 300), kind: "fix" });
    done();
    return { ok: true, data: { before: before.overall, after: report.overall, summary: summarize(report), notes: r.notes, status: STATUS_LABEL[report.status] } };
  } catch (e) {
    return fail(e);
  }
}

/** Applies every safe (deterministic, placeholder-free) fix, re-scoring between passes. */
export async function applySafeFixesAction(draftId: string): Promise<ActionResult<ScoreChange & { applied: string[] }>> {
  try {
    const user = await requireUser();
    let draft = await getDraft(user.id, id.parse(draftId));
    const first = await reportFor(user.id, draft);
    let report = first;
    const applied: string[] = [];
    for (let pass = 0; pass < 3; pass++) {
      const safe = report.findings.flatMap((f) => (f.fixes ?? []).filter((o) => o.safe && o.fix).map((o) => o));
      let cur = inputOf(draft);
      let changed = false;
      for (const o of safe) {
        const r = applyFix(cur, o.fix!);
        if (r.changed) {
          cur = r.draft;
          changed = true;
          applied.push(o.label);
        }
      }
      if (!changed) break;
      ({ draft, report } = await updateDraft(user.id, draft.id, cur));
    }
    if (!applied.length) throw new AppError("There are no safe fixes left to apply.");
    report = await addRevision(user.id, draft, `Applied ${applied.length} safe fixes`, "fix");
    done();
    return { ok: true, data: { before: first.overall, after: report.overall, summary: summarize(report), notes: [], status: STATUS_LABEL[report.status], applied } };
  } catch (e) {
    return fail(e);
  }
}

/** Ask Claude for the AI fix offered on a finding; returns options to preview (nothing is changed yet). */
export async function aiProposeAction(draftId: string, feature: string, optionId: string): Promise<ActionResult<AiProposal>> {
  try {
    const user = await requireUser();
    const draft = await getDraft(user.id, id.parse(draftId));
    const report = await reportFor(user.id, draft);
    const option = report.findings.find((f) => f.feature === feature)?.fixes?.find((o) => o.id === optionId);
    if (!option?.ai) throw new AppError("That recommendation no longer applies. Refresh the page.");
    return { ok: true, data: await aiFix(inputOf(draft), report, option.ai.task, option.ai.instruction, option.ai.target) };
  } catch (e) {
    return fail(e);
  }
}

/** Free-form AI rewrite of one section (AI Optimization tab). */
export async function aiRewriteSectionAction(draftId: string, heading: string, instruction: string): Promise<ActionResult<AiProposal>> {
  try {
    const user = await requireUser();
    const draft = await getDraft(user.id, id.parse(draftId));
    const report = await reportFor(user.id, draft);
    const ask = z.string().trim().min(3, "Describe the change you want.").max(1000).parse(instruction);
    const h = z.string().max(300).parse(heading);
    const task = h === "__intro" ? "intro" : h === "__conclusion" ? "conclusion" : "section";
    return { ok: true, data: await aiFix(inputOf(draft), report, task, ask, task === "section" ? h : undefined) };
  } catch (e) {
    return fail(e);
  }
}

export async function researchAction(draftId: string, competitors?: string[]): Promise<ActionResult<{ notes: string[]; competitors: number }>> {
  try {
    const user = await requireUser();
    let draft = await getDraft(user.id, id.parse(draftId));
    if (competitors) ({ draft } = await updateDraft(user.id, draft.id, { meta: { competitors: z.array(z.string().trim().max(500)).max(10).parse(competitors.filter(Boolean)) } }));
    const research = await runResearch(user.id, researchInputOf(draft));
    await saveBundle(draft.id, { research });
    await addRevision(user.id, draft, `SERP research: ${research.competitors.filter((c) => !c.error).length} pages analyzed`, "research");
    done();
    return { ok: true, data: { notes: research.notes, competitors: research.competitors.filter((c) => !c.error).length } };
  } catch (e) {
    return fail(e);
  }
}

export async function aiReviewAction(draftId: string): Promise<ActionResult<ScoreChange>> {
  try {
    const user = await requireUser();
    const draft = await getDraft(user.id, id.parse(draftId));
    const before = draft.score;
    const bundle = await getBundle(draft.id);
    const ai = await aiReview(inputOf(draft), bundle.research, bodyHash(draft.body));
    await saveBundle(draft.id, { ai });
    const report = await addRevision(user.id, draft, "Claude review", "research");
    done();
    return { ok: true, data: { before, after: report.overall, summary: summarize(report), notes: [], status: STATUS_LABEL[report.status] } };
  } catch (e) {
    return fail(e);
  }
}

export async function checkLinksAction(draftId: string): Promise<ActionResult<{ broken: number; checked: number }>> {
  try {
    const user = await requireUser();
    const draft = await getDraft(user.id, id.parse(draftId));
    const links = await checkLinks(draft);
    await saveBundle(draft.id, { links });
    done();
    return { ok: true, data: { checked: links.results.length, broken: links.results.filter((r) => r.error || (r.status ?? 0) >= 400).length } };
  } catch (e) {
    return fail(e);
  }
}

export async function checkLiveAction(draftId: string): Promise<ActionResult<{ status: number | null; error: string | null }>> {
  try {
    const user = await requireUser();
    const draft = await getDraft(user.id, id.parse(draftId));
    const live = await checkLive(draft);
    await saveBundle(draft.id, { live });
    done();
    return { ok: true, data: { status: live.status, error: live.error } };
  } catch (e) {
    return fail(e);
  }
}

export async function loadSitemapAction(draftId: string, url: string): Promise<ActionResult<{ pages: number }>> {
  try {
    const user = await requireUser();
    const pages = await loadSitemap(z.string().max(500).parse(url));
    await updateDraft(user.id, id.parse(draftId), { meta: { sitePages: pages, sitemapUrl: url.trim() } }, { note: `Loaded ${pages.length} site pages from the sitemap`, kind: "edit" });
    done();
    return { ok: true, data: { pages: pages.length } };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreRevisionAction(draftId: string, revisionId: string): Promise<ActionResult<ScoreChange>> {
  try {
    const user = await requireUser();
    const draft = await getDraft(user.id, id.parse(draftId));
    const snap = await revisionSnapshot(user.id, draft.id, id.parse(revisionId));
    const { report } = await updateDraft(user.id, draft.id, { ...snap, meta: snap.meta }, { note: "Restored an earlier revision", kind: "restore" });
    done();
    return { ok: true, data: { before: draft.score, after: report.overall, summary: summarize(report), notes: [], status: STATUS_LABEL[report.status] } };
  } catch (e) {
    return fail(e);
  }
}

export async function setChecklistAction(draftId: string, key: string, value: boolean): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    const draft = await getDraft(user.id, id.parse(draftId));
    await updateDraft(user.id, draft.id, { meta: { checklist: { ...(draft.meta.checklist ?? {}), [z.string().max(80).parse(key)]: value } } });
    done();
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

/** Publish: refused while publication blockers remain; marks the draft published and stamps dates. */
export async function publishAction(draftId: string): Promise<ActionResult<{ status: string }>> {
  try {
    const user = await requireUser();
    const draft = await getDraft(user.id, id.parse(draftId));
    const report = await reportFor(user.id, draft);
    if (report.blockers.length) throw new AppError(`Resolve ${report.blockers.length} publication blocker${report.blockers.length === 1 ? "" : "s"} first: ${report.blockers[0].message}`);
    const today = new Date().toISOString().slice(0, 10);
    const { draft: fresh } = await updateDraft(user.id, draft.id, { meta: { publishedAt: draft.meta.publishedAt || today, modifiedAt: today } });
    await setStatus(user.id, draft.id, "published");
    await addRevision(user.id, fresh, `Published (score ${report.overall ?? "n/a"}/10, ${STATUS_LABEL[report.status].toLowerCase()})`, "publish");
    done();
    return { ok: true, data: { status: "published" } };
  } catch (e) {
    return fail(e);
  }
}

export async function unpublishAction(draftId: string): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    const draft = await getDraft(user.id, id.parse(draftId));
    await setStatus(user.id, draft.id, "draft");
    await addRevision(user.id, draft, "Moved back to draft", "edit");
    done();
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteDraftAction(draftId: string): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    await deleteDraft(user.id, id.parse(draftId));
    done();
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function duplicateDraftAction(draftId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const d = await duplicateDraft(user.id, id.parse(draftId));
    done();
    return { ok: true, data: { id: d.id } };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------------------------ briefs

const briefInput = z.object({
  keyword: z.string().trim().min(1, "Enter a keyword or topic.").max(120),
  db: z.string().max(4).optional(),
  competitors: z.array(z.string().trim().max(500)).max(10).optional(),
  audience: z.string().trim().max(200).optional(),
  useAi: z.boolean().optional(),
});

export async function generateBriefAction(raw: z.input<typeof briefInput>): Promise<ActionResult<{ id: string; brief: Brief }>> {
  try {
    const user = await requireUser();
    const input = briefInput.parse(raw);
    const db = database(input.db ?? "US").code;
    const research = await runResearch(user.id, { keyword: input.keyword, db, competitors: input.competitors?.filter(Boolean) });
    const brief = input.useAi ? await aiBrief(input.keyword, db, research, input.audience) : researchBrief(input.keyword, db, research);
    const briefId = await saveBrief(user.id, brief);
    done();
    return { ok: true, data: { id: briefId, brief } };
  } catch (e) {
    return fail(e);
  }
}

export async function draftFromBriefAction(briefId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const b = await getBrief(user.id, id.parse(briefId));
    const draft = await createDraft(user.id, { keyword: b.keyword, title: b.brief.titleIdeas[0] ?? "", metaDescription: b.brief.metaDescription, body: briefToMarkdown(b.brief), meta: { db: b.db, funnel: b.brief.funnel, robots: "index, follow" }, brief: b.brief });
    await linkBrief(user.id, b.id, draft.id);
    done();
    return { ok: true, data: { id: draft.id } };
  } catch (e) {
    return fail(e);
  }
}
