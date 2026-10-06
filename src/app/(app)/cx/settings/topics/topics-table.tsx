"use client";

import { Copy, MessageSquareText, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteTopicEditorAction, duplicateTopicEditorAction, setTopicActiveAction } from "@/app/(app)/cx/listening/topics/actions";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm";
import { MenuItem } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/feedback";
import { GearMenu, KDate, KSection, runOk } from "../_admin/k-ui";
import { useRun } from "../_admin/ui";

export type TopicRow = { id: string; name: string; active: boolean; contains: string[]; andContains: string[]; excluded: string[]; creator: string | null; createdAt: string; mentions: number };

/** Settings → Topics: Konnect's topics table with ADD NEW TOPIC and a gear menu per row. */
export function TopicsTable({ brand, topics, canEdit }: { brand: string; topics: TopicRow[]; canEdit: boolean }) {
  const router = useRouter();
  const { run, busy, error, setError, messages } = useRun();
  const [del, setDel] = useState<TopicRow | null>(null);
  const editor = (id: string) => `/cx/listening/topics?brand=${brand}&topic=${id}`;
  const menu = (t: TopicRow) => (
    <GearMenu label={`Actions for ${t.name}`}>
      {(close) => (
        <>
          <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} href={editor(t.id)}>{canEdit ? "Edit" : "View"}</MenuItem>
          {canEdit && <MenuItem icon={<Copy className="h-3.5 w-3.5" />} onClick={async () => { close(); const id = await run(`d-${t.id}`, duplicateTopicEditorAction(brand, t.id), () => `Duplicated ${t.name} (paused until you activate it).`); if (id) router.refresh(); }}>Duplicate</MenuItem>}
          {canEdit && <MenuItem icon={t.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} onClick={() => { close(); run(`a-${t.id}`, setTopicActiveAction(brand, t.id, !t.active), () => `${t.name} ${t.active ? "paused" : "activated"}.`); }}>{t.active ? "Pause" : "Activate"}</MenuItem>}
          {canEdit && <MenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { close(); setError(null); setDel(t); }}>Delete</MenuItem>}
        </>
      )}
    </GearMenu>
  );
  const list = (v: string[]) => (v.length ? v.join(", ") : <span className="text-text-3">n/a</span>);
  return (
    <KSection title="Topics" action={canEdit && <Link href={editor("new")} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-brand px-2.5 text-[12.5px] font-medium tracking-[0.06em] text-white uppercase shadow-card hover:bg-brand-hover"><Plus className="h-3.5 w-3.5" />Add new topic</Link>}>
      {messages}
      {topics.length === 0 ? (
        <EmptyState icon={<MessageSquareText className="h-5 w-5" />} title="No topics yet" description="A topic is a set of keywords listening collects mentions for: your brand, competitors, campaigns." action={canEdit ? <Link href={editor("new")} className="text-[13px] text-link hover:underline">Create the first topic →</Link> : undefined} />
      ) : (
        <>
          <table className="hidden w-full table-fixed border-collapse text-left text-[13px] md:table">
            <thead>
              <tr className="border-b border-border text-[11.5px] font-semibold tracking-wide text-text uppercase">
                <th className="w-[15%] py-2 pr-3">Topic name</th>
                <th className="py-2 pr-3">Contains</th>
                <th className="w-[16%] py-2 pr-3">And contains</th>
                <th className="w-[16%] py-2 pr-3">Does not contain</th>
                <th className="w-[13%] py-2 pr-3">Created by</th>
                <th className="w-12 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {topics.map((t) => (
                <tr key={t.id} className="border-b border-border align-middle last:border-0">
                  <td className="py-3 pr-3">
                    <Link href={editor(t.id)} className="flex items-center gap-2 font-semibold text-text hover:text-link">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-text-2"><MessageSquareText className="h-3.5 w-3.5" /></span>
                      <span className="min-w-0 break-words">{t.name}</span>
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-1 pl-9">{!t.active && <Badge>Paused</Badge>}<span className="text-[11.5px] text-text-3">{t.mentions} mentions</span></div>
                  </td>
                  <td className="py-3 pr-3 break-words text-text-2">{list(t.contains)}</td>
                  <td className="py-3 pr-3 break-words text-text-2">{list(t.andContains)}</td>
                  <td className="py-3 pr-3 break-words text-text-2">{list(t.excluded)}</td>
                  <td className="py-3 pr-3 text-text-2"><div className="truncate">{t.creator ?? "n/a"}</div><KDate iso={t.createdAt} /></td>
                  <td className="py-3 text-right">{menu(t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-border md:hidden">
            {topics.map((t) => (
              <li key={t.id} className="py-3 text-[13px]">
                <div className="flex items-start justify-between gap-2">
                  <Link href={editor(t.id)} className="font-semibold text-text">{t.name}</Link>
                  <div className="flex items-center gap-1">{!t.active && <Badge>Paused</Badge>}{menu(t)}</div>
                </div>
                <dl className="mt-1 space-y-1 text-text-2">
                  <div><dt className="inline font-semibold text-text">Contains: </dt><dd className="inline break-words">{list(t.contains)}</dd></div>
                  <div><dt className="inline font-semibold text-text">And contains: </dt><dd className="inline">{list(t.andContains)}</dd></div>
                  <div><dt className="inline font-semibold text-text">Does not contain: </dt><dd className="inline">{list(t.excluded)}</dd></div>
                  <div className="text-[12px] text-text-3">{t.creator ?? "n/a"} · <KDate iso={t.createdAt} /></div>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
      <ConfirmDialog open={!!del} onCancel={() => setDel(null)} title={del ? `Delete “${del.name}”?` : "Delete topic?"} busy={busy === "del"} error={del ? error : null}
        description="Listening stops collecting for it. Its mentions stay but lose their topic, and clusters drop it."
        onConfirm={async () => { if (del && (await runOk(run, "del", deleteTopicEditorAction(brand, del.id), () => `${del.name} deleted.`))) setDel(null); }} />
    </KSection>
  );
}
