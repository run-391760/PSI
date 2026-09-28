import { requireUser } from "@/lib/auth";
import { BULK_COLUMNS, BULK_TEMPLATE, parseCsv } from "@/lib/cx/publishing/core";
import { writeXlsx } from "@/lib/cx/publishing/xlsx";

export const dynamic = "force-dynamic";

const GUIDE: string[][] = [
  ["Column", "Required", "Format / example"],
  ["date", "yes", "YYYY-MM-DD (text) or an Excel date, e.g. 2026-10-05"],
  ["time", "no (09:00)", "HH:MM 24-hour in your browser's time zone, or an Excel time"],
  ["channels", "yes", "facebook, instagram, linkedin, x, youtube, threads, gbp — separate with | or ;"],
  ["text", "yes", "Post text; put {link} where the tracked short link goes. For polls, the question."],
  ["link", "no", "Destination URL starting with https://"],
  ["campaign", "no", "Campaign name (created if new)"],
  ["first_comment", "no", "Posted as the first comment (Facebook, Instagram, LinkedIn) or reply (X)"],
  ["media", "no", "Asset library file names separated by |"],
  ["post_type", "no (text)", "text, story, reel, poll, document or event"],
  ["tags", "no", "Content tags separated by | (new tags need a tag manager)"],
  ["poll_options", "for polls", "2–4 answers separated by |, e.g. Dark mode|Exports (X: 25 characters each, LinkedIn: 30)"],
  ["", "", ""],
  ["Tip", "", "Keep the header row. Rows with errors are reported by row number and skipped; valid rows are scheduled."],
];

/** Excel template for bulk scheduling (Posts sheet + Guide sheet). */
export async function GET() {
  await requireUser();
  const rows = parseCsv(BULK_TEMPLATE);
  const bytes = writeXlsx([
    { name: "Posts", rows: [BULK_COLUMNS, ...rows.slice(1)], widths: [12, 8, 20, 50, 30, 16, 24, 20, 11, 14, 26] },
    { name: "Guide", rows: GUIDE, widths: [16, 12, 90] },
  ]);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="bulk-schedule-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
