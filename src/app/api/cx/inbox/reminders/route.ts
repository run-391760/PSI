import { NextResponse } from "next/server";
import { AppError } from "@/lib/domain";
import { brandUser } from "@/lib/cx/inbox/guard";
import { dismissReminder, dueReminders } from "@/lib/cx/inbox/workspace";

export const dynamic = "force-dynamic";

/** Reminder pop-ups: GET fires due reminders and returns mine not yet dismissed; POST {id} dismisses one. */
export async function GET(req: Request) {
  try {
    const brand = new URL(req.url).searchParams.get("brand") ?? "";
    const { user } = await brandUser(brand, { write: false });
    return NextResponse.json({ reminders: await dueReminders(brand, user.id) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: e instanceof AppError ? e.status : 500 });
  }
}
export async function POST(req: Request) {
  try {
    const brand = new URL(req.url).searchParams.get("brand") ?? "";
    const { user } = await brandUser(brand, { write: false });
    const { id } = (await req.json().catch(() => ({}))) as { id?: string };
    if (id) await dismissReminder(brand, user.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: e instanceof AppError ? e.status : 500 });
  }
}
