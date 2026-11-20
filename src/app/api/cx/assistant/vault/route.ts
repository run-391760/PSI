import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { getCxBrand } from "@/lib/cx/context";
import { VAULT_LIMITS, addVaultDoc, extractText } from "@/lib/cx/insights/vault";

export const dynamic = "force-dynamic";

/** Upload documents to the AI assistant's knowledge vault (multipart "file", up to 10 per request). */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const brand = await getCxBrand(user.id, new URL(req.url).searchParams.get("brand") ?? "", { write: true });
    const form = await req.formData();
    const files = form.getAll("file").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f).slice(0, 10);
    if (!files.length) throw new AppError("Choose a file to upload.");
    const added: { name: string; chunks: number }[] = [];
    const failed: { name: string; error: string }[] = [];
    for (const f of files) {
      try {
        if (f.size > VAULT_LIMITS.fileBytes) throw new AppError(`Larger than ${VAULT_LIMITS.fileBytes / 1024 / 1024} MB.`);
        const text = extractText(f.name, Buffer.from(await f.arrayBuffer()));
        const r = await addVaultDoc(brand.id, user.id, { title: f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "), text, filename: f.name });
        added.push({ name: f.name, chunks: r.chunks });
      } catch (e) {
        failed.push({ name: f.name, error: e instanceof Error ? e.message : "Upload failed" });
      }
    }
    return NextResponse.json({ added, failed }, { status: added.length ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: e instanceof AppError ? e.status : 500 });
  }
}
