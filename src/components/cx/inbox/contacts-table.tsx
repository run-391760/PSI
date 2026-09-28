"use client";

import { Users } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { mergeContactsAction } from "@/app/(app)/cx/contacts/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/input";
import type { ContactListRow } from "@/lib/cx/inbox/contacts";
import { CHANNELS } from "@/lib/cx/channels";
import { Ago } from "./time";
import { Avatar, ChannelIcon, channelLabel, SentimentBadge } from "./ui";
import Link from "next/link";

export function ContactsTable({ brand, rows, tags, filters }: { brand: string; rows: ContactListRow[]; tags: string[]; filters: { q: string; tag: string; channel: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [q, setQ] = useState(filters.q);
  const [error, setError] = useState<string | null>(null);
  const go = (patch: Record<string, string>) => {
    const p = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) if (v) p.set(k, v); else p.delete(k);
    router.push(`${pathname}?${p.toString()}`);
  };
  const columns: Column<ContactListRow>[] = [
    {
      key: "name", header: "Contact", sortValue: (r) => r.name.toLowerCase(), csv: (r) => r.name,
      render: (r) => (
        <Link href={`/cx/contacts/${r.id}?brand=${brand}`} className="flex min-w-0 items-center gap-2">
          <Avatar name={r.name || r.email || "?"} className="h-7 w-7 text-[11px]" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-link hover:underline">{r.name || "Unnamed"}</span>
            <span className="block truncate text-[12px] text-text-3">{r.email ?? r.phone ?? Object.values(r.handles)[0] ?? ""}</span>
          </span>
        </Link>
      ),
    },
    { key: "email", header: "Email", exportOnly: true, csv: (r) => r.email ?? "" },
    { key: "phone", header: "Phone", exportOnly: true, csv: (r) => r.phone ?? "" },
    { key: "channels", header: "Channels", sortValue: (r) => r.channels.length, csv: (r) => r.channels.join("; "), render: (r) => <span className="flex gap-1.5 text-text-2">{r.channels.map((c) => <span key={c} title={channelLabel(c)}><ChannelIcon kind={c} /></span>)}</span> },
    { key: "tickets", header: "Tickets", align: "right", sortValue: (r) => r.tickets, render: (r) => <span className="tabular-nums">{r.tickets}{r.open > 0 && <span className="ml-1 text-[12px] text-warning-ink">({r.open} open)</span>}</span> },
    { key: "sentiment", header: "Last sentiment", hideOnMobile: true, render: (r) => <SentimentBadge sentiment={r.sentiment} /> },
    { key: "tags", header: "Tags", hideOnMobile: true, sortable: false, csv: (r) => r.tags.join("; "), render: (r) => <span className="flex flex-wrap gap-1">{r.tags.slice(0, 3).map((t) => <span key={t} className="rounded bg-surface-3 px-1.5 text-[11.5px] text-text-2">{t}</span>)}</span> },
    { key: "last_seen", header: "Last seen", align: "right", sortValue: (r) => r.last_seen, render: (r) => <Ago iso={r.last_seen} className="text-text-2" /> },
    { key: "first_seen", header: "First seen", align: "right", hideOnMobile: true, sortValue: (r) => r.first_seen, render: (r) => <Ago iso={r.first_seen} className="text-text-3" /> },
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <form onSubmit={(e) => { e.preventDefault(); go({ q: q.trim() }); }} className="min-w-[200px] flex-1">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone or handle" aria-label="Search contacts" className="h-8" />
        </form>
        <Select value={filters.channel} onChange={(e) => go({ channel: e.target.value })} className="h-8 w-auto text-[13px]" aria-label="Channel">
          <option value="">All channels</option>
          {[...CHANNELS.filter((c) => c.uses.includes("inbox")).map((c) => [c.kind, c.name]), ["phone", "Phone"]].map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </Select>
        {tags.length > 0 && (
          <Select value={filters.tag} onChange={(e) => go({ tag: e.target.value })} className="h-8 w-auto text-[13px]" aria-label="Tag">
            <option value="">All tags</option>
            {tags.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        )}
      </div>
      {error && <Callout tone="critical" className="m-3">{error}</Callout>}
      {rows.length === 0 ? (
        <EmptyState icon={<Users className="h-5 w-5" />} title={filters.q || filters.tag || filters.channel ? "No contacts match" : "No contacts yet"} description="Contacts are created automatically when someone emails you, chats, submits a form or messages you on a connected channel." />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          defaultSort={{ key: "last_seen", dir: "desc" }}
          exportName={`contacts-${brand}`}
          selectable
          selectionActions={(sel, clear) => sel.length >= 2 ? (
            <Button size="sm" onClick={async () => {
              const target = [...sel].sort((a, b) => b.tickets - a.tickets || a.first_seen.localeCompare(b.first_seen))[0];
              const r = await mergeContactsAction(brand, target.id, sel.filter((s) => s.id !== target.id).map((s) => s.id));
              if (!r.ok) setError(r.error); else { clear(); router.refresh(); }
            }}>Merge {sel.length} into one</Button>
          ) : null}
          dense
        />
      )}
    </Card>
  );
}
