import { redirect } from "next/navigation";

/** /cx/settings opens Omni-Channel Setup (Konnect behaviour); the admin card hub lives at /cx/settings/admin. */
export default async function CxSettingsPage({ searchParams }: PageProps<"/cx/settings">) {
  const sp = await searchParams;
  const brand = typeof sp.brand === "string" ? sp.brand : null;
  redirect(brand ? `/cx/settings/channels?brand=${encodeURIComponent(brand)}` : "/cx/settings/channels");
}
