import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { ContactProfile } from "@/components/cx/inbox/contact-profile";
import { NoBrand } from "@/components/cx/inbox/ui";
import { Page, PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { duplicateCandidates, getContact } from "@/lib/cx/inbox/contacts";

export const metadata: Metadata = { title: "Contact" };

export default async function ContactPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { brand, switcher } = await cxContext(user.id, sp);
  if (!brand) return <NoBrand title="Contact" breadcrumbs={[{ label: "CX" }, { label: "Contacts" }]} redirect="/cx/contacts" />;
  const detail = await getContact(brand.id, id);
  if (!detail) notFound();
  const dupes = await duplicateCandidates(brand.id, id);
  const c = detail.contact;
  const open = detail.tickets.filter((t) => !["solved", "closed"].includes(t.status)).length;
  return (
    <Page>
      <PageHeader
        title={c.name || "Unnamed contact"}
        subject={c.email ?? c.phone ?? undefined}
        breadcrumbs={[{ label: "CX" }, { label: "Contacts", href: `/cx/contacts?brand=${brand.id}` }, { label: c.name || "Contact" }]}
        meta={
          <>
            <Badge>{detail.tickets.length} tickets</Badge>
            {open > 0 && <Badge tone="warning">{open} open</Badge>}
            {detail.mentions.length > 0 && <Badge tone="info">{detail.mentions.length} mentions</Badge>}
            <Badge tone="neutral">Source: your inbox data</Badge>
          </>
        }
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
      />
      <ContactProfile brand={brand.id} detail={detail} duplicates={dupes} />
    </Page>
  );
}
