import { NextResponse } from "next/server";
import { storeSocial } from "@/lib/cx/inbox/social";
import { mapWhatsApp, verifyMetaSignature } from "@/lib/cx/inbox/webhooks";

/**
 * WhatsApp Business Cloud API webhook.
 * Setup (Meta App → WhatsApp → Configuration): Callback URL = https://<your-host>/api/cx/webhooks/whatsapp,
 * Verify token = the value of WHATSAPP_VERIFY_TOKEN, subscribe to "messages". Set META_APP_SECRET to
 * enforce X-Hub-Signature-256 verification. Then connect a WhatsApp channel (Settings → Channels) with
 * the phone number id; inbound messages become tickets. Replies need WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID.
 */
export async function GET(req: Request) {
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!token) return NextResponse.json({ error: "WHATSAPP_VERIFY_TOKEN is not configured" }, { status: 503 });
  const u = new URL(req.url).searchParams;
  if (u.get("hub.mode") === "subscribe" && u.get("hub.verify_token") === token) return new NextResponse(u.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

export async function POST(req: Request) {
  if (!process.env.WHATSAPP_VERIFY_TOKEN) return NextResponse.json({ error: "WhatsApp is not configured" }, { status: 503 });
  const raw = await req.text();
  const secret = process.env.META_APP_SECRET;
  if (secret && !verifyMetaSignature(secret, raw, req.headers.get("x-hub-signature-256"))) return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const stored = await storeSocial(mapWhatsApp(body as Record<string, unknown>)).catch((e) => (console.error("[whatsapp webhook]", e), 0));
  return NextResponse.json({ ok: true, stored });
}
