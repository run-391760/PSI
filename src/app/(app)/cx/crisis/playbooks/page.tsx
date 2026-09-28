import type { Metadata } from "next";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { PlaybookManager } from "@/components/cx/listening/crisis-v2";
import { ListeningNav } from "@/components/cx/listening/listening-nav";
import { NoBrand } from "@/components/cx/listening/no-brand";
import { Page, PageHeader } from "@/components/shell/page";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { listPlaybooks } from "@/lib/cx/listening/crisis2";

export const metadata: Metadata = { title: "Crisis playbooks" };

export default async function PlaybooksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Crisis playbooks" />;
  const playbooks = await listPlaybooks(brand.id);
  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: "CX" }, { label: "Crisis", href: `/cx/crisis?brand=${brand.id}` }, { label: "Playbooks" }]}
        title="Crisis playbooks"
        subject={brand.name}
        description="Checklists your team follows when a crisis opens. Attach them to events manually or automatically; every completed step is logged on the event timeline."
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
      />
      <ListeningNav current="/cx/crisis/playbooks" brandId={brand.id} />
      <PlaybookManager brandId={brand.id} playbooks={playbooks} />
    </Page>
  );
}
