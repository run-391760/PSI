import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Page, PageHeader } from "@/components/shell/page";
import { requirePageUser } from "@/lib/auth";
import { listCxBrands } from "@/lib/cx/context";

/** Shown when a brand's IP allowlist (Settings → Users → IP whitelisting) blocks the current address. */
export default async function IpBlockedPage({ searchParams }: PageProps<"/cx/ip-blocked">) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const ip = typeof sp.ip === "string" ? sp.ip.slice(0, 64) : "unknown";
  const others = (await listCxBrands(user.id)).filter((b) => b.id !== sp.brand);
  return (
    <Page>
      <PageHeader title="Access restricted" breadcrumbs={[{ label: "CX" }]} />
      <Card>
        <EmptyState
          icon={<ShieldAlert className="h-5 w-5" />}
          title="This brand only allows approved IP addresses"
          description={`Your current address (${ip}) isn't on the brand's allowlist. Ask the brand owner or an admin to add it in Settings → Users → IP whitelisting.`}
        />
        {others.length > 0 && (
          <div className="border-t border-border px-4 py-3 text-[13px] text-text-2">
            Open another brand: {others.slice(0, 6).map((b, i) => <span key={b.id}>{i > 0 && " · "}<Link href={`/cx/inbox?brand=${b.id}`} className="text-link hover:underline">{b.name}</Link></span>)}
          </div>
        )}
      </Card>
    </Page>
  );
}
