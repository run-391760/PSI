import { NextResponse } from "next/server";
import { rateLimit, requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { MAX_UPLOAD_BYTES, ingestStream } from "@/lib/content/logs/ingest";
import { saveAnalysis } from "@/lib/content/logs/store";
import { verifyBots } from "@/lib/content/logs/verify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Upload an access log as the raw request body (POST ?name=access.log). The body is streamed,
 * decompressed when gzipped, parsed line by line and only aggregates are stored.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    await rateLimit(`content-logs:${user.id}`, 30, 3600);
    const url = new URL(request.url);
    const name = (url.searchParams.get("name") || "access.log").replace(/[^\w.\- ()]+/g, "_").slice(0, 120) || "access.log";
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > MAX_UPLOAD_BYTES) throw new AppError("The file is larger than 50 MB. Upload a shorter period or a .gz compressed log.", 413);
    if (!request.body) throw new AppError("No file received.");
    const { agg, bytes } = await ingestStream(request.body);
    const verification = await verifyBots(agg);
    const summary = agg.finish(verification);
    const id = await saveAnalysis(user.id, { name, origin: "upload", sizeBytes: bytes, summary });
    return NextResponse.json({ id, lines: summary.totals.lines, parsed: summary.totals.parsed });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    if (!(e instanceof AppError)) console.error("[content] log upload failed:", e);
    return NextResponse.json({ error: e instanceof AppError ? e.message : "The upload failed. Please try again." }, { status });
  }
}
