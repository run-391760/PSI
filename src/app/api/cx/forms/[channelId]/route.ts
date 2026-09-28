import { NextResponse } from "next/server";
import { submitForm } from "@/lib/cx/inbox/chat";
import { guarded, json, preflight } from "../../chat/cors";

/**
 * Web form submissions. Accepts JSON (hosted form page / fetch) or a plain HTML form post
 * (application/x-www-form-urlencoded or multipart) from any website, which redirects back to the
 * hosted thank-you page. Fields: name, email, phone, subject, message; "website" is a honeypot.
 */
export const OPTIONS = preflight;

export async function POST(req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  const type = req.headers.get("content-type") ?? "";
  const isJson = type.includes("application/json");
  let data: Record<string, string> = {};
  if (isJson) data = (await req.json().catch(() => ({}))) as Record<string, string>;
  else {
    const fd = await req.formData().catch(() => null);
    if (fd) for (const [k, v] of fd.entries()) if (typeof v === "string") data[k] = v;
  }
  return guarded(req, "form", 8, async () => {
    try {
      const r = await submitForm(channelId, { ...data, pageUrl: data.pageUrl || req.headers.get("referer") || "" });
      if (isJson) return json(r);
      return NextResponse.redirect(new URL(`/f/${channelId}?sent=1`, req.url), 303);
    } catch (e) {
      if (isJson) throw e;
      const msg = e instanceof Error ? e.message : "Error";
      return NextResponse.redirect(new URL(`/f/${channelId}?error=${encodeURIComponent(msg)}`, req.url), 303);
    }
  });
}
