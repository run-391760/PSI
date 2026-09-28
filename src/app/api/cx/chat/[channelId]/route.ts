import { chatChannel, pollChat, sendChat, startChat } from "@/lib/cx/inbox/chat";
import { guarded, json, preflight } from "../cors";

/**
 * Live chat API used by the widget and the hosted chat page.
 * GET ?token=&typing=1 → messages since the session started (polling); GET without token → widget config.
 * POST {action:"start", name, email, pageUrl} → {token}; POST {action:"send", token, text}.
 */
export const OPTIONS = preflight;

export async function GET(req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  return guarded(req, "chat-poll", 120, async () => {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    if (!token) {
      const ch = await chatChannel(channelId);
      if (!ch) return json({ error: "Chat not available" }, 404);
      return json({ brand: ch.brand, config: ch.config, agentsOnline: ch.agentsOnline });
    }
    return json(await pollChat(channelId, token, url.searchParams.get("typing") === "1"));
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  if (body.action === "start")
    return guarded(req, "chat-start", 10, async () => json(await startChat(channelId, { name: body.name, email: body.email, pageUrl: body.pageUrl, userAgent: req.headers.get("user-agent") ?? "" })));
  if (body.action === "send") return guarded(req, "chat-send", 30, async () => json(await sendChat(channelId, body.token ?? "", body.text ?? "")));
  return json({ error: "Unknown action" }, 400);
}
