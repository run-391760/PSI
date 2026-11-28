import { redirect } from "next/navigation";

/** Listening opens the per-platform dashboards (the old Mentions page was removed); brand and filters are kept. */
export default async function ListeningHome({ searchParams }: PageProps<"/cx/listening">) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  const qs = q.toString();
  redirect(`/cx/listening/platforms${qs ? `?${qs}` : ""}`);
}
