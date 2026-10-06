"use client";

import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { deleteCampaignAction, reschedulePostAction, saveCampaignAction } from "@/app/(app)/cx/publishing/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { PUB_CHANNELS, STATUS_LABEL, type PostStatus } from "@/lib/cx/publishing/core";
import { cn } from "@/lib/utils";
import { ChannelChip } from "./shared";

export type CalPost = { id: string; title: string; status: PostStatus; channels: string[]; campaign_id: string | null; at: string | null };
export type CalCampaign = { id: string; name: string; color: number; starts_on: string | null; ends_on: string | null; notes: string; posts: number };

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfWeek = (d: Date) => addDays(d, -((d.getDay() + 6) % 7)); // Monday
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATUS_DOT: Record<PostStatus, string> = { draft: "bg-border-strong", pending: "bg-warning", approved: "bg-link", scheduled: "bg-brand", published: "bg-good", failed: "bg-critical" };

export function Calendar({ brandId, posts: initial, campaigns, canAuthor }: { brandId: string; posts: CalPost[]; campaigns: CalCampaign[]; canAuthor: boolean }) {
  const router = useRouter();
  const [posts, setPosts] = useState(initial);
  useEffect(() => setPosts(initial), [initial]);
  const [view, setView] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState<Date | null>(null);
  const [channel, setChannel] = useState("");
  const [campaign, setCampaign] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [, start] = useTransition();
  useEffect(() => setAnchor(new Date()), []); // today is only known on the client (time zone)

  const filtered = useMemo(() => posts.filter((p) => (!channel || p.channels.includes(channel)) && (!campaign || p.campaign_id === campaign)), [posts, channel, campaign]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalPost[]>();
    for (const p of filtered) {
      if (!p.at) continue;
      const k = ymd(new Date(p.at));
      m.set(k, [...(m.get(k) ?? []), p].sort((a, b) => a.at!.localeCompare(b.at!)));
    }
    return m;
  }, [filtered]);
  const unscheduled = filtered.filter((p) => !p.at);

  if (!anchor) return <Card className="h-[520px]">{null}</Card>;
  const first = view === "month" ? startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1)) : startOfWeek(anchor);
  const days = Array.from({ length: view === "month" ? 42 : 7 }, (_, i) => addDays(first, i));
  const today = ymd(new Date());
  const move = (n: number) => setAnchor(view === "month" ? new Date(anchor.getFullYear(), anchor.getMonth() + n, 1) : addDays(anchor, 7 * n));
  const label = view === "month" ? anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" }) : `${days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${days[6].toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  const campaignOn = (d: string) => campaigns.filter((c) => c.starts_on && c.starts_on <= d && (c.ends_on ?? c.starts_on) >= d && (!campaign || c.id === campaign));

  const drop = (day: Date, id: string) => {
    const p = posts.find((x) => x.id === id);
    if (!p || p.status === "published") return;
    const old = p.at ? new Date(p.at) : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0);
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), old.getHours(), old.getMinutes());
    const iso = next.toISOString();
    setPosts((ps) => ps.map((x) => (x.id === id ? { ...x, at: iso } : x)));
    start(async () => {
      const r = await reschedulePostAction(brandId, id, iso);
      if (!r.ok) {
        setError(r.error);
        setPosts(initial);
      } else {
        setError(null);
        router.refresh();
      }
    });
  };

  const chip = (p: CalPost, big = false) => (
    <Link
      key={p.id}
      href={`/cx/publishing/${p.id}?brand=${brandId}`}
      draggable={canAuthor && p.status !== "published"}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", p.id)}
      title={`${p.title} · ${STATUS_LABEL[p.status]} · ${p.channels.join(", ")}`}
      className={cn("flex min-w-0 items-center gap-1 rounded border border-border bg-surface px-1 py-0.5 text-[11.5px] hover:border-border-strong", canAuthor && p.status !== "published" && "cursor-grab", big && "py-1.5")}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[p.status])} />
      {p.at && <span className="hidden shrink-0 text-text-3 sm:inline">{new Date(p.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>}
      <span className="truncate">{p.title}</span>
    </Link>
  );

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="ghost" onClick={() => move(-1)} aria-label="Previous"><ChevronLeft className="h-4 w-4" /></Button>
        <Button size="sm" onClick={() => setAnchor(new Date())}>Today</Button>
        <Button size="icon" variant="ghost" onClick={() => move(1)} aria-label="Next"><ChevronRight className="h-4 w-4" /></Button>
        <h2 className="mr-auto text-[15px] font-semibold" suppressHydrationWarning>{label}</h2>
        <Select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel" className="w-36">
          <option value="">All channels</option>
          {PUB_CHANNELS.map((c) => <option key={c.kind} value={c.kind}>{c.name}</option>)}
        </Select>
        <Select value={campaign} onChange={(e) => setCampaign(e.target.value)} aria-label="Campaign" className="w-40">
          <option value="">All campaigns</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Segmented options={[{ value: "month", label: "Month" }, { value: "week", label: "Week" }]} value={view} onChange={setView} />
      </div>
      {error && <Callout tone="critical">{error}</Callout>}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-center text-[11.5px] font-medium text-text-2">
          {DOW.map((d) => <div key={d} className="py-1.5">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const k = ymd(d);
            const list = byDay.get(k) ?? [];
            const out = view === "month" && d.getMonth() !== anchor.getMonth();
            const camps = campaignOn(k);
            return (
              <div
                key={k}
                onDragOver={(e) => { if (canAuthor) { e.preventDefault(); setDragOver(k); } }}
                onDragLeave={() => setDragOver((x) => (x === k ? null : x))}
                onDrop={(e) => { e.preventDefault(); setDragOver(null); drop(d, e.dataTransfer.getData("text/plain")); }}
                className={cn("group relative min-w-0 border-r border-b border-border p-1 [&:nth-child(7n)]:border-r-0", view === "month" ? "min-h-[92px]" : "min-h-[360px]", out && "bg-surface-2/60", dragOver === k && "bg-brand-soft")}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11.5px]", k === today ? "bg-brand font-semibold text-white" : out ? "text-text-3" : "text-text-2")}>{d.getDate()}</span>
                  {canAuthor && (
                    <Link href={`/cx/publishing/new?brand=${brandId}&date=${k}`} className="hidden rounded p-0.5 text-text-3 group-hover:block hover:bg-surface-3" aria-label={`New post on ${k}`}>
                      <Plus className="h-3 w-3" />
                    </Link>
                  )}
                </div>
                {camps.map((c) => <div key={c.id} className="mb-0.5 h-1 rounded-full" style={{ background: `var(--series-${c.color})` }} title={c.name} />)}
                <div className="grid gap-0.5">
                  {(view === "month" ? list.slice(0, 3) : list).map((p) => chip(p, view === "week"))}
                  {view === "month" && list.length > 3 && <span className="px-1 text-[11px] text-text-3">+{list.length - 3} more</span>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <div className="flex flex-wrap gap-3 text-[12px] text-text-2">
        {(Object.keys(STATUS_DOT) as PostStatus[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1"><span className={cn("h-2 w-2 rounded-full", STATUS_DOT[s])} />{STATUS_LABEL[s]}</span>
        ))}
        {canAuthor && <span className="text-text-3">Drag a post to another day to reschedule (time of day is kept).</span>}
      </div>
      {unscheduled.length > 0 && (
        <Card>
          <CardHeader title="Not scheduled yet" description="Drag onto a day to plan it (scheduling itself happens in the post)." />
          <CardBody className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{unscheduled.slice(0, 30).map((p) => chip(p, true))}</CardBody>
        </Card>
      )}
      <Card className="sm:hidden">
        <CardHeader title="Agenda" />
        <CardBody className="grid gap-2">
          {days.filter((d) => byDay.has(ymd(d))).map((d) => (
            <div key={ymd(d)}>
              <div className="mb-1 text-[12px] font-medium text-text-2">{d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div>
              <div className="grid gap-1">
                {byDay.get(ymd(d))!.map((p) => (
                  <Link key={p.id} href={`/cx/publishing/${p.id}?brand=${brandId}`} className="flex items-center gap-2 rounded border border-border px-2 py-1.5 text-[12.5px]">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[p.status])} />
                    <span className="shrink-0 text-text-3">{new Date(p.at!).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
                    <span className="truncate">{p.title}</span>
                    <span className="ml-auto flex gap-0.5">{p.channels.map((c) => <ChannelChip key={c} kind={c} />)}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
          {!days.some((d) => byDay.has(ymd(d))) && <p className="text-[12.5px] text-text-3">Nothing planned in this period.</p>}
        </CardBody>
      </Card>
    </div>
  );
}

type Draft = { id?: string; name: string; color: number; starts_on: string; ends_on: string; notes: string };

export function CampaignsCard({ brandId, campaigns, canAuthor }: { brandId: string; campaigns: CalCampaign[]; canAuthor: boolean }) {
  const router = useRouter();
  const [edit, setEdit] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { confirm, confirmDialog } = useConfirm();
  const save = () =>
    start(async () => {
      const r = await saveCampaignAction(brandId, { ...edit!, starts_on: edit!.starts_on || null, ends_on: edit!.ends_on || null });
      if (!r.ok) return setError(r.error);
      setError(null);
      setEdit(null);
      router.refresh();
    });
  return (
    <Card>
      <CardHeader
        title="Campaigns"
        description="Group posts and short links; campaign dates show as colored bars."
        actions={canAuthor && <Button size="sm" onClick={() => { setError(null); setEdit({ name: "", color: (campaigns.length % 8) + 1, starts_on: "", ends_on: "", notes: "" }); }}><Plus className="h-3.5 w-3.5" /> New</Button>}
      />
      <CardBody className="grid gap-1.5">
        {campaigns.length ? (
          campaigns.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-[13px] hover:bg-surface-2">
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: `var(--series-${c.color})` }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.name}</span>
                <span className="block text-[11.5px] text-text-3">
                  {c.starts_on ? `${c.starts_on}${c.ends_on && c.ends_on !== c.starts_on ? ` → ${c.ends_on}` : ""}` : "No dates"} · {c.posts} post{c.posts === 1 ? "" : "s"}
                </span>
              </span>
              {canAuthor && (
                <>
                  <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => { setError(null); setEdit({ id: c.id, name: c.name, color: c.color, starts_on: c.starts_on ?? "", ends_on: c.ends_on ?? "", notes: c.notes }); }}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" aria-label="Delete" disabled={pending} onClick={async () => (await confirm({ title: `Delete the campaign “${c.name}”?`, description: "Its posts stay, without a campaign." })) && start(async () => { await deleteCampaignAction(brandId, c.id); router.refresh(); })}><Trash2 className="h-3.5 w-3.5" /></Button>
                </>
              )}
            </div>
          ))
        ) : (
          <p className="text-[12.5px] text-text-3">No campaigns yet.</p>
        )}
        <ButtonLink href={`/cx/publishing?brand=${brandId}&tab=links`} variant="link" size="sm" className="mt-1 justify-start">Campaign short links →</ButtonLink>
      </CardBody>
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? "Edit campaign" : "New campaign"}
        error={error}
        onSubmit={() => !pending && edit?.name.trim() && save()}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button type="submit" variant="primary" loading={pending} disabled={pending || !edit?.name.trim()}>Save</Button></>}
      >
        {edit && (
          <div className="grid gap-3">
            <Field label="Name" htmlFor="cp-name"><Input id="cp-name" autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts" htmlFor="cp-s"><Input id="cp-s" type="date" value={edit.starts_on} onChange={(e) => setEdit({ ...edit, starts_on: e.target.value })} /></Field>
              <Field label="Ends" htmlFor="cp-e"><Input id="cp-e" type="date" value={edit.ends_on} onChange={(e) => setEdit({ ...edit, ends_on: e.target.value })} /></Field>
            </div>
            <div>
              <span className="mb-1 block text-[13px] font-medium">Color</span>
              <div className="flex gap-1.5">
                {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" aria-label={`Color ${n}`} aria-pressed={edit.color === n} onClick={() => setEdit({ ...edit, color: n })} className={cn("h-8 w-8 rounded-md border-2", edit.color === n ? "border-text" : "border-transparent")} style={{ background: `var(--series-${n})` }} />
                ))}
              </div>
            </div>
            <Field label="Notes" htmlFor="cp-n"><Textarea id="cp-n" rows={3} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          </div>
        )}
      </Dialog>
      {confirmDialog}
    </Card>
  );
}
