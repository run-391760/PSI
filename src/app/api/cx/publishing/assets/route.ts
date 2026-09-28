import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { requireBrand, storeAsset } from "@/lib/cx/publishing/data";

export const dynamic = "force-dynamic";

/** Upload images/videos to a brand's asset library (multipart: brand, tags, file[]). */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const access = await requireBrand(user.id, String(form.get("brand") ?? ""), "author");
    const tags = String(form.get("tags") ?? "").split(",");
    const files = form.getAll("file").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f);
    if (!files.length) throw new AppError("Choose at least one file.");
    const ids: string[] = [];
    const errors: string[] = [];
    for (const f of files.slice(0, 20)) {
      try {
        ids.push(await storeAsset(access.brand.id, user.id, { name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) }, tags));
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    return NextResponse.json({ ids, errors }, { status: ids.length ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: e instanceof AppError ? e.status : 500 });
  }
}
