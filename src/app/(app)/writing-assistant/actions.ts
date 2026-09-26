"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { crawlPage } from "@/lib/crawler";
import { AppError, rootDomain, safeUrl } from "@/lib/domain";
import { fail, type ActionResult } from "@/lib/content/action";
import { createDocument, deleteDocument, duplicateDocument, targetsFor, updateDocument, type DocPatch, type DocSettings } from "@/lib/content/documents";
import { extractPage } from "@/lib/content/extract";
import { wordList } from "@/lib/content/text";

const createInput = z.object({
  title: z.string().trim().max(200).optional(),
  keywords: z.array(z.string().trim().max(100)).max(10).optional(),
  db: z.string().max(4).optional(),
});

export async function createDocumentAction(input: z.input<typeof createInput>): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const id = await createDocument(user.id, createInput.parse(input));
    revalidatePath("/writing-assistant");
    return { ok: true, data: { id } };
  } catch (e) {
    return fail(e);
  }
}

export async function saveDocumentAction(id: string, patch: DocPatch): Promise<ActionResult<{ updatedAt: string }>> {
  try {
    const user = await requireUser();
    const updatedAt = await updateDocument(user.id, z.string().max(64).parse(id), patch);
    return { ok: true, data: { updatedAt } };
  } catch (e) {
    return fail(e);
  }
}

export async function renameDocumentAction(id: string, title: string): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    if (!title.trim()) throw new AppError("Enter a title.");
    await updateDocument(user.id, id, { title });
    revalidatePath("/writing-assistant");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteDocumentAction(ids: string[]): Promise<ActionResult<null>> {
  try {
    const user = await requireUser();
    for (const id of z.array(z.string().max(64)).max(200).parse(ids)) await deleteDocument(user.id, id);
    revalidatePath("/writing-assistant");
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export async function duplicateDocumentAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const newId = await duplicateDocument(user.id, id);
    revalidatePath("/writing-assistant");
    return { ok: true, data: { id: newId } };
  } catch (e) {
    return fail(e);
  }
}

/** Recompute recommended keywords and targets from the top-10 benchmark (demo) for new keywords. */
export async function recommendTargetsAction(keywords: string[], db: string): Promise<ActionResult<DocSettings>> {
  try {
    await requireUser();
    return { ok: true, data: targetsFor(z.array(z.string().trim().min(1).max(100)).max(10).parse(keywords), db) };
  } catch (e) {
    return fail(e);
  }
}

/** Fetch a public page (robots.txt respected) and return its main text as Markdown. */
export async function importUrlAction(input: string): Promise<ActionResult<{ url: string; title: string; markdown: string; words: number }>> {
  try {
    await requireUser();
    const raw = input.trim();
    if (!raw) throw new AppError("Enter a URL.");
    let url: string;
    try {
      url = safeUrl(new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).toString());
    } catch (e) {
      throw e instanceof AppError ? e : new AppError("Enter a valid http(s) URL.");
    }
    const res = await crawlPage(url);
    if (res.status >= 400) throw new AppError(`The page returned HTTP ${res.status}.`);
    const type = String(res.headers["content-type"] ?? "text/html");
    if (!/html|text\/plain/i.test(type)) throw new AppError(`That URL is not an HTML page (${type.split(";")[0]}).`);
    const { facts, markdown } = extractPage(res.body, res.url, res.status, res.headers, rootDomain(res.url));
    const md = markdown.slice(0, 150_000);
    const words = wordList(md).length;
    if (words < 20) throw new AppError("No readable main text was found on that page (it may rely on JavaScript to render).");
    return { ok: true, data: { url: res.url, title: facts.title || facts.h1s[0] || res.url, markdown: md, words } };
  } catch (e) {
    return fail(e);
  }
}
