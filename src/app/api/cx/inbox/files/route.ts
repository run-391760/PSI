import { NextResponse } from "next/server";
import { AppError } from "@/lib/domain";
import { saveFile } from "@/lib/cx/inbox/files";
import { brandUser } from "@/lib/cx/inbox/guard";

export const dynamic = "force-dynamic";

/** Upload reply / note / assignment / email attachments (multipart "file", up to 10 per request, 25 MB each). */
export async function POST(req: Request) {
  try {
    const brand = new URL(req.url).searchParams.get("brand") ?? "";
    const { user } = await brandUser(brand);
    const form = await req.formData();
    const files = form.getAll("file").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f).slice(0, 10);
    if (!files.length) throw new AppError("Choose a file to attach.");
    const out = [];
    for (const f of files) out.push(await saveFile(brand, user.id, null, { name: f.name || "pasted-image.png", type: f.type, bytes: Buffer.from(await f.arrayBuffer()) }));
    return NextResponse.json({ files: out });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: e instanceof AppError ? e.status : 500 });
  }
}
