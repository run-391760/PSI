import { gzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { generateSampleLog } from "@/lib/content/logs/sample";

export const dynamic = "force-dynamic";

/** Download a 7-day sample access log (Combined format, gzipped) to try the upload flow. */
export async function GET() {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }
  const body = gzipSync(generateSampleLog({ days: 7 }));
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": 'attachment; filename="sample-access.log.gz"',
      "Cache-Control": "no-store",
    },
  });
}
