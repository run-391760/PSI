import { NextResponse } from "next/server";
import { storeSocial } from "@/lib/cx/inbox/social";
import { mapMeta, verifyMetaSignature } from "@/lib/cx/inbox/webhooks";

/**
 * Meta webhook for Facebook Messenger (object "page") and Instagram messaging (object "instagram").
 * Setup (Meta App → Webhooks): Callback URL = https://<your-host>/api/cx/webhooks/meta, Verify token =
 * META_VERIFY_TOKEN, subscribe the Page / Instagram account to "messages". META_APP_SECRET is required
 * (signature check). Connect a Facebook / Instagram channel in Settings → Channels with the Page / IG
 * account id (and a Page access token to send replies).
 */
export async function GET(req: Request) {
  const token = process.env.META_VERIFY_TOKEN;
  if (!token) return NextResponse.json({ error: "META_VERIFY_TOKEN is not configured" }, { status: 503 });
  const u = new URL(req.url).searchParams;
  if (u.get("hub.mode") === "subscribe" && u.get("hub.verify_token") === token) return new NextResponse(u.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

export async function POST(req: Request) {
  const secret = process.env.META_APP_SECRET;
  if (!process.env.META_VERIFY_TOKEN || !secret) return NextResponse.json({ error: "Meta webhooks are not configured" }, { status: 503 });
  const raw = await req.text();
  if (!verifyMetaSignature(secret, raw, req.headers.get("x-hub-signature-256"))) return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const stored = await storeSocial(mapMeta(body as Record<string, unknown>)).catch((e) => (console.error("[meta webhook]", e), 0));
  return NextResponse.json({ ok: true, stored });
}
