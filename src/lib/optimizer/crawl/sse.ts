import type { CrawlEvent } from "./types";

/**
 * Server-Sent Events framing for the live crawler (client-safe). One event per frame: `event:` is
 * the event type and `data:` the JSON payload on a single line (JSON.stringify escapes newlines).
 */

export function encodeEvent(event: CrawlEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Keep-alive comment frame (ignored by parsers; stops proxies from closing an idle stream). */
export const HEARTBEAT = ": ping\n\n";

/**
 * Incremental parser: feed decoded text chunks, get complete events back. Handles frames split
 * across chunks, CRLF line endings, comments and multi-line `data:` fields.
 */
export function sseParser() {
  let buffer = "";
  return (chunk: string): CrawlEvent[] => {
    buffer += chunk.replace(/\r\n?/g, "\n");
    const out: CrawlEvent[] = [];
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) continue;
      try {
        const parsed = JSON.parse(data) as CrawlEvent;
        if (parsed && typeof parsed === "object" && typeof parsed.type === "string") out.push(parsed);
      } catch {
        /* A malformed frame is skipped; the stream continues. */
      }
    }
    return out;
  };
}
