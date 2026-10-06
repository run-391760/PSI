import { randomUUID } from "node:crypto";
import { rateLimit, requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { runCrawl } from "@/lib/optimizer/crawl/run";
import { clampPages, normalizeStartUrl } from "@/lib/optimizer/crawl/scope";
import { encodeEvent, HEARTBEAT } from "@/lib/optimizer/crawl/sse";
import { deleteCrawl, getCrawl, listCrawls, saveCrawl } from "@/lib/optimizer/crawl/store";
import type { CrawlEvent } from "@/lib/optimizer/crawl/types";

export const dynamic = "force-dynamic";

/**
 * Live crawler API.
 * POST {url, maxPages} → Server-Sent Events of a polite crawl (start, queue, page, touch, flag,
 * score, skip, summary, done | error). Closing the connection stops the crawl; the partial result is
 * still saved. One crawl per user at a time: starting another stops the previous one.
 * GET → past crawls; GET ?id= → one stored crawl (for replay); DELETE ?id= → remove it.
 */

const g = globalThis as typeof globalThis & { __optCrawlActive?: Map<string, AbortController> };
const active = (g.__optCrawlActive ??= new Map());

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
function failure(e: unknown) {
  const status = e instanceof AppError ? e.status : 500;
  if (status === 500) console.error("[optimizer/crawl]", e);
  return json({ error: e instanceof AppError ? e.message : "Something went wrong." }, status);
}

export async function POST(request: Request) {
  let user;
  let startUrl: string;
  let maxPages: number;
  try {
    user = await requireUser();
    const body = (await request.json().catch(() => ({}))) as { url?: unknown; maxPages?: unknown };
    const url = normalizeStartUrl(typeof body.url === "string" ? body.url.slice(0, 500) : "");
    if (!url) throw new AppError("Enter a website URL such as example.com or https://example.com/blog/.");
    startUrl = url;
    maxPages = clampPages(body.maxPages);
    await rateLimit(`opt-crawl:${user.id}`, 30, 3600);
  } catch (e) {
    return failure(e);
  }

  const ownerId = user.id;
  active.get(ownerId)?.abort();
  const controller = new AbortController();
  active.set(ownerId, controller);
  const signal = AbortSignal.any([request.signal, controller.signal]);
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(out) {
      let closed = false;
      const write = (text: string) => {
        if (closed) return;
        try {
          out.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };
      const send = (e: CrawlEvent) => write(encodeEvent(e));
      const beat = setInterval(() => write(HEARTBEAT), 15_000);
      void (async () => {
        try {
          const result = await runCrawl({ id, startUrl, maxPages, signal, emit: send });
          let saved = false;
          if (result.pages.length) {
            saved = await saveCrawl(ownerId, { id, startUrl, domain: result.domain, status: result.status, maxPages, pages: result.pages, skips: result.skips, summary: result.summary, startedAt })
              .then(() => true)
              .catch((e) => (console.error("[optimizer/crawl] save", e), false));
          }
          send({ type: "done", id, status: result.status, saved });
        } catch (e) {
          if (!(e instanceof AppError)) console.error("[optimizer/crawl]", e);
          send({ type: "error", message: e instanceof AppError ? e.message : "The crawl failed unexpectedly." });
        } finally {
          clearInterval(beat);
          if (active.get(ownerId) === controller) active.delete(ownerId);
          if (!closed) {
            closed = true;
            try {
              out.close();
            } catch {
              /* already closed by the client */
            }
          }
        }
      })();
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform keeps compression from buffering the stream; X-Accel-Buffering disables proxy buffering.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const id = new URL(request.url).searchParams.get("id");
    if (id) return json(await getCrawl(user.id, id.slice(0, 64)));
    return json(await listCrawls(user.id));
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new AppError("Missing crawl id.");
    await deleteCrawl(user.id, id.slice(0, 64));
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
