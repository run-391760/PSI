import { AppError } from "@/lib/domain";
import { auditHtml, crawlPage, describeFetchError, parseLinks } from "@/lib/crawler";
import type { LinkStatus } from "./types";

export type LinkCheck = { status: Exclude<LinkStatus, "pending">; reason: string; anchor: string | null; rel: string[]; targetUrl: string | null; httpStatus: number | null };

/**
 * Real verification: fetch the source page with the SSRF-safe crawler (robots.txt respected, 15s
 * timeout, 2 MB limit) and look for <a href> links pointing to the project domain.
 */
export async function checkLink(sourceUrl: string, domain: string): Promise<LinkCheck> {
  let res: Awaited<ReturnType<typeof crawlPage>>;
  try {
    res = await crawlPage(sourceUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof AppError) {
      if (/robots\.txt/i.test(msg) && /disallow/i.test(msg)) return { status: "unknown", reason: "Blocked by robots.txt — the page can't be checked.", anchor: null, rel: [], targetUrl: null, httpStatus: null };
      if (/robots\.txt is unavailable/i.test(msg)) return { status: "unknown", reason: "robots.txt is unavailable (server error); check deferred.", anchor: null, rel: [], targetUrl: null, httpStatus: null };
      if (/timed out/i.test(msg)) return { status: "unknown", reason: "Timed out after 15 seconds.", anchor: null, rel: [], targetUrl: null, httpStatus: null };
      if (/private|reserved/i.test(msg)) return { status: "unknown", reason: "Blocked: the host resolves to a private or reserved address.", anchor: null, rel: [], targetUrl: null, httpStatus: null };
      return { status: "unknown", reason: msg, anchor: null, rel: [], targetUrl: null, httpStatus: null };
    }
    const d = describeFetchError(e);
    return { status: "unknown", reason: d.code === "ENOTFOUND" ? "Domain does not resolve (DNS lookup failed)." : d.message, anchor: null, rel: [], targetUrl: null, httpStatus: null };
  }
  const code = res.status;
  if (code === 404 || code === 410) return { status: "lost", reason: `Page not found (HTTP ${code}).`, anchor: null, rel: [], targetUrl: null, httpStatus: code };
  if (code === 401 || code === 403) return { status: "unknown", reason: `Access denied (HTTP ${code}); the site may block crawlers.`, anchor: null, rel: [], targetUrl: null, httpStatus: code };
  if (code === 429) return { status: "unknown", reason: "Rate limited by the site (HTTP 429); will retry on the next check.", anchor: null, rel: [], targetUrl: null, httpStatus: code };
  if (code >= 400 && code < 500) return { status: "unknown", reason: `Client error (HTTP ${code}).`, anchor: null, rel: [], targetUrl: null, httpStatus: code };
  if (code >= 500) return { status: "unknown", reason: `Server error (HTTP ${code}).`, anchor: null, rel: [], targetUrl: null, httpStatus: code };
  if (code >= 300) return { status: "unknown", reason: `Unexpected redirect status (HTTP ${code}).`, anchor: null, rel: [], targetUrl: null, httpStatus: code };
  const type = String(res.headers["content-type"] ?? "");
  if (type && !/html|xml/i.test(type)) return { status: "unknown", reason: `Not an HTML page (${type.split(";")[0]}).`, anchor: null, rel: [], targetUrl: null, httpStatus: code };

  const links = parseLinks(res.body, res.url, domain);
  if (!links.length) return { status: "lost", reason: `No link to ${domain} found on the page.`, anchor: null, rel: [], targetUrl: null, httpStatus: code };
  const best = links.find((l) => l.follow) ?? links[0];
  const robots = auditHtml(res.body, res.url, res.headers).robots.toLowerCase();
  const notes = [`${links.length} link${links.length === 1 ? "" : "s"} to ${domain} found`];
  if (!best.follow) notes.push("nofollow");
  if (/noindex|none/.test(robots)) notes.push("page is noindex");
  if (/nofollow|none/.test(robots)) notes.push("page-level nofollow");
  if (res.url !== sourceUrl) notes.push(`redirected to ${res.url}`);
  return { status: "active", reason: `${notes.join(" · ")}.`, anchor: best.anchor || (best.target ? "" : null), rel: best.rel.filter((r) => ["nofollow", "ugc", "sponsored"].includes(r)), targetUrl: best.target, httpStatus: code };
}
