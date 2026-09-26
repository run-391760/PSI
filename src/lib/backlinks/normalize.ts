import { tryRootDomain } from "@/lib/domain";

/**
 * Root domain of user input, tolerant of hosts that are themselves on the Public Suffix List
 * (github.io, blogspot.com, httpbin.org…), which `tryRootDomain` rejects. Client-safe.
 */
export function looseRootDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const strict = tryRootDomain(input);
  if (strict) return strict;
  try {
    const raw = input.trim();
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(u.protocol) || u.port || u.username || u.password) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && !/^[\d.]+$/.test(host) && /[a-z]/.test(host.split(".").pop() ?? "")) return host;
  } catch {
    /* not a URL */
  }
  return null;
}
