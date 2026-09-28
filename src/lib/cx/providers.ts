import { CHANNELS, type ChannelKind } from "./channels";
import { liveEnabled } from "@/lib/providers/source";

/** Which channel APIs are usable on this server (env configured, or free with no key). */
export function channelAvailable(kind: ChannelKind): boolean {
  const info = CHANNELS.find((c) => c.kind === kind);
  if (!info) return false;
  if (kind === "google-reviews") return liveEnabled();
  if (["email", "livechat", "webform"].includes(kind)) return true; // configured per channel
  return info.env.every((e) => !!process.env[e]);
}
export const availableChannels = () => Object.fromEntries(CHANNELS.map((c) => [c.kind, channelAvailable(c.kind)])) as Record<ChannelKind, boolean>;
