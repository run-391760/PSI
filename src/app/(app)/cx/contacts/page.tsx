import type { Metadata } from "next";
import { BrandSwitcher } from "@/components/cx/brand-switcher";
import { ContactsTable } from "@/components/cx/inbox/contacts-table";
import { NoBrand } from "@/components/cx/inbox/ui";
import { Page, PageHeader } from "@/components/shell/page";
import { Metric, MetricStrip } from "@/components/ui/metric";
import { requirePageUser } from "@/lib/auth";
import { cxContext } from "@/lib/cx/context";
import { contactTags, listContacts } from "@/lib/cx/inbox/contacts";
import { num } from "@/lib/format";

export const metadata: Metadata = { title: "Contacts" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const { brand, switcher } = await cxContext(user.id, sp);
  const crumbs = [{ label: "CX" }, { label: "Contacts" }];
  if (!brand) return <NoBrand title="Contacts" breadcrumbs={crumbs} redirect="/cx/contacts" />;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const [rows, tags] = await Promise.all([listContacts(brand.id, { q: s("q"), tag: s("tag"), channel: s("channel") }), contactTags(brand.id)]);
  const week = Date.now() - 7 * 86_400_000;
  const multi = rows.filter((r) => r.channels.length > 1).length;
  return (
    <Page>
      <PageHeader
        title="Contacts"
        subject={brand.name}
        breadcrumbs={crumbs}
        description="Every customer who reached you on any channel, unified into one profile with their full history."
        actions={<BrandSwitcher brands={switcher} current={brand.id} />}
      />
      <MetricStrip className="mb-4">
        <Metric label="Contacts" value={num(rows.length)} size="sm" />
        <Metric label="Active (7d)" value={num(rows.filter((r) => new Date(r.last_seen).getTime() > week).length)} size="sm" />
        <Metric label="New (7d)" value={num(rows.filter((r) => new Date(r.first_seen).getTime() > week).length)} size="sm" />
        <Metric label="With open tickets" value={num(rows.filter((r) => r.open > 0).length)} size="sm" />
        <Metric label="Multi-channel" value={num(multi)} size="sm" info="Contacts who reached you on more than one channel." />
      </MetricStrip>
      <ContactsTable brand={brand.id} rows={rows} tags={tags} filters={{ q: s("q") ?? "", tag: s("tag") ?? "", channel: s("channel") ?? "" }} />
    </Page>
  );
}
