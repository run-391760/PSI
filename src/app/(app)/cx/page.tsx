import { redirect } from "next/navigation";

/** /cx opens the ticket inbox (the CX overview page was removed); the brand is kept. */
export default async function CxHome({ searchParams }: PageProps<"/cx">) {
  const sp = await searchParams;
  redirect(typeof sp.brand === "string" ? `/cx/inbox?brand=${encodeURIComponent(sp.brand)}` : "/cx/inbox");
}
