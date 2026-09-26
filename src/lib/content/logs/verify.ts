import { lookup, reverse } from "node:dns/promises";
import { botById } from "./bots";
import type { LogAggregator, LogSummary } from "./parser";

type Verification = LogSummary["bots"][number]["verification"];

function withTimeout<T>(p: Promise<T>, ms: number) {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), ms))]);
}

/** true = verified, false = PTR missing or mismatched (possible spoof), null = lookup unavailable. */
async function verifyIp(ip: string, suffixes: string[]): Promise<boolean | null> {
  let names: string[];
  try {
    names = await withTimeout(reverse(ip), 2500);
  } catch (e) {
    const code = (e as { code?: string }).code;
    return code === "ENOTFOUND" || code === "ENODATA" ? false : null;
  }
  for (const n of names) {
    const host = n.toLowerCase().replace(/\.$/, "");
    if (!suffixes.some((s) => host === s || host.endsWith(`.${s}`))) continue;
    try {
      const addrs = await withTimeout(lookup(host, { all: true }), 2500);
      if (addrs.some((a) => a.address === ip)) return true;
    } catch {
      return null;
    }
  }
  return false;
}

/**
 * Google/Bing/Apple/Yandex/Baidu-recommended verification: reverse DNS of the busiest IPs must end in
 * the engine's domain and resolve forward to the same IP. Other bots stay "unverified UA".
 */
export async function verifyBots(agg: LogAggregator, budgetMs = 7000): Promise<Record<string, Verification>> {
  const out: Record<string, Verification> = {};
  const tasks = agg.botIds().map(async (id) => {
    const def = botById(id);
    if (!def?.rdns) return;
    const ips = agg.topIps(id, 3);
    const results = await Promise.all(ips.map((ip) => verifyIp(ip, def.rdns!)));
    const checked = results.filter((r) => r !== null).length;
    const verified = results.filter((r) => r === true).length;
    out[id] = !checked
      ? { status: "unverified", checked: 0, verified: 0, note: "Reverse DNS lookup was unavailable." }
      : { status: verified === checked ? "verified" : verified ? "partial" : "failed", checked, verified, note: `${verified} of ${checked} busiest IPs passed reverse + forward DNS.` };
  });
  await Promise.race([Promise.all(tasks), new Promise((r) => setTimeout(r, budgetMs))]);
  return out;
}
