import { redirect } from "next/navigation";

/** Profile groups are now Clusters. */
export default async function ProfileGroupsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const brand = typeof sp.brand === "string" ? sp.brand : null;
  redirect(brand ? `/cx/settings/clusters?brand=${encodeURIComponent(brand)}` : "/cx/settings/clusters");
}
