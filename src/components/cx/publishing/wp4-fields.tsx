"use client";

import { Check, Clock, Hash, X as XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { pubChannel, type PubChannel } from "@/lib/cx/publishing/core";
import { commonFieldsFor, fieldsFor, normTag, type OptionField, type OptionValue, type PostOptions } from "@/lib/cx/publishing/options";
import { localBuckets, nextOccurrence, slotLabel, topSlots, type HashtagSuggestion } from "@/lib/cx/publishing/suggest";
import { cn } from "@/lib/utils";
import { ChannelChip } from "./shared";

// ---------------------------------------------------------------- per-network options

function OptionInput({ f, id, value, onChange, disabled, assets }: { f: OptionField; id: string; value: OptionValue | undefined; onChange: (v: OptionValue | undefined) => void; disabled: boolean; assets: { id: string; filename: string; mime: string }[] }) {
  if (f.kind === "bool")
    return (
      <label className="flex items-start gap-2 text-[13px]">
        <Checkbox className="mt-0.5" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked || undefined)} />
        <span>
          {f.label}
          {!f.api && <ManualBadge />}
          {f.hint && <span className="block text-[12px] text-text-3">{f.hint}</span>}
        </span>
      </label>
    );
  const label = (
    <span>
      {f.label}
      {!f.api && <ManualBadge />}
    </span>
  );
  return (
    <Field label={label} htmlFor={id} hint={f.hint}>
      {f.kind === "select" ? (
        <Select id={id} value={typeof value === "string" ? value : ""} disabled={disabled} onChange={(e) => onChange(e.target.value || undefined)}>
          {!f.choices?.some((c) => c.value === "") && <option value="">Default</option>}
          {f.choices?.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
      ) : f.kind === "list" ? (
        <Textarea id={id} rows={2} value={Array.isArray(value) ? value.join("\n") : typeof value === "string" ? value : ""} disabled={disabled} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value ? e.target.value.split("\n") : undefined)} />
      ) : f.kind === "asset" ? (
        <Select id={id} value={typeof value === "string" ? value : ""} disabled={disabled} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">None</option>
          {assets.filter((a) => a.mime.startsWith("image/")).map((a) => <option key={a.id} value={a.id}>{a.filename}</option>)}
        </Select>
      ) : (
        <Input id={id} type={f.kind === "date" ? "date" : "text"} value={typeof value === "string" ? value : ""} maxLength={f.max} disabled={disabled} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value || undefined)} />
      )}
    </Field>
  );
}
const ManualBadge = () => <span className="ml-1.5 rounded bg-surface-3 px-1 py-px text-[10.5px] font-normal text-text-3" title="Not in the network's API: kept with the post as a reminder for manual steps">manual</span>;

export function NetworkOptions({ channels, postType, options, onChange, disabled, assets }: { channels: string[]; postType: string; options: PostOptions; onChange: (o: PostOptions) => void; disabled: boolean; assets: { id: string; filename: string; mime: string }[] }) {
  const common = commonFieldsFor(postType);
  const per = channels.map((k) => ({ k: k as PubChannel, fields: fieldsFor(k as PubChannel, postType) })).filter((x) => x.fields.length);
  const [open, setOpen] = useState<string>(common.length ? "common" : (per[0]?.k ?? ""));
  useEffect(() => {
    if (open !== "common" && !per.some((p) => p.k === open)) setOpen(common.length ? "common" : (per[0]?.k ?? ""));
  }, [open, per, common.length]);
  if (!common.length && !per.length) return <p className="text-[12.5px] text-text-3">No extra options for the selected channels and post type.</p>;
  const set = (scope: string, key: string, v: OptionValue | undefined) => {
    const cur = { ...((options as Record<string, Record<string, OptionValue>>)[scope] ?? {}) };
    if (v === undefined) delete cur[key];
    else cur[key] = v;
    onChange({ ...options, [scope]: cur });
  };
  const tabs = [...(common.length ? [{ k: "common", label: "Poll" }] : []), ...per.map((p) => ({ k: p.k, label: pubChannel(p.k)?.name ?? p.k }))];
  const fields = open === "common" ? common : (per.find((p) => p.k === open)?.fields ?? []);
  const scopeVals = (options as Record<string, Record<string, OptionValue>>)[open] ?? {};
  return (
    <div className="grid gap-3">
      <div className="scroll-thin flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => {
          const n = Object.keys((options as Record<string, object>)[t.k] ?? {}).length;
          return (
            <button key={t.k} type="button" onClick={() => setOpen(t.k)} className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] whitespace-nowrap", open === t.k ? "border-brand font-medium text-text" : "border-transparent text-text-2")}>
              {t.k !== "common" && <ChannelChip kind={t.k} />}
              {t.label}
              {n > 0 && <span className="text-[11px] text-text-3">{n}</span>}
            </button>
          );
        })}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key} className={cn(f.kind === "list" || f.kind === "bool" ? "sm:col-span-2" : "")}>
            <OptionInput f={f} id={`opt-${open}-${f.key}`} value={scopeVals[f.key]} onChange={(v) => set(open, f.key, v)} disabled={disabled} assets={assets} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- approver picker

export type ApproverOption = { user_id: string; name: string };
export function ApproverPicker({ approvers, value, onChange, disabled }: { approvers: ApproverOption[]; value: string[]; onChange: (v: string[]) => void; disabled: boolean }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[13px] font-medium">Approvers</span>
      {approvers.length ? (
        <div className="flex flex-wrap gap-1.5">
          {approvers.map((a) => {
            const on = value.includes(a.user_id);
            return (
              <button
                key={a.user_id}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                onClick={() => onChange(on ? value.filter((v) => v !== a.user_id) : [...value, a.user_id])}
                className={cn("flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12.5px]", on ? "border-brand bg-brand-soft text-text" : "border-border-strong text-text-2 hover:bg-surface-3")}
              >
                {on && <Check className="h-3 w-3" />}
                {a.name}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-[12px] text-text-3">No approvers on this brand yet.</p>
      )}
      <p className="text-[12px] text-text-3">{value.length > 1 ? `All ${value.length} must approve before the post can be scheduled.` : value.length === 1 ? "This approver must approve." : "None picked: any approver (default: the brand owner) can approve."}</p>
    </div>
  );
}

export type DecisionItem = { user_id: string; name: string; decision: string; comment: string; at: string };
export function ApprovalProgress({ approvers, designated, decisions }: { approvers: ApproverOption[]; designated: string[]; decisions: DecisionItem[] }) {
  if (!designated.length) return null;
  return (
    <ul className="grid gap-1 text-[12.5px]">
      {designated.map((u) => {
        const d = decisions.find((x) => x.user_id === u);
        const name = approvers.find((a) => a.user_id === u)?.name ?? d?.name ?? "Approver";
        return (
          <li key={u} className="flex items-center justify-between gap-2">
            <span>{name}</span>
            <Badge tone={d?.decision === "approved" ? "good" : d?.decision === "rejected" ? "critical" : "neutral"}>{d?.decision === "approved" ? "Approved" : d?.decision === "rejected" ? "Changes requested" : "Waiting"}</Badge>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- content tags

export function TagPicker({ defined, value, onChange, disabled, canCreate, locked }: { defined: string[]; value: string[]; onChange: (v: string[]) => void; disabled: boolean; canCreate: boolean; locked: boolean }) {
  const [text, setText] = useState("");
  const add = (t: string) => {
    const n = normTag(t);
    if (n && !value.includes(n)) onChange([...value, n]);
    setText("");
  };
  const options = defined.filter((t) => !value.includes(t) && t.includes(normTag(text)));
  const off = disabled || locked;
  return (
    <div className="grid gap-1.5">
      <span className="text-[13px] font-medium">Content tags</span>
      <div className="flex flex-wrap gap-1">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[12px]">
            #{t}
            {!off && (
              <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((v) => v !== t))}>
                <XIcon className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        {!value.length && <span className="text-[12px] text-text-3">No tags</span>}
      </div>
      {!off && (
        <>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim()) {
                e.preventDefault();
                const n = normTag(text);
                if (canCreate || defined.includes(n)) add(n);
              }
            }}
            placeholder={canCreate ? "Add or create a tag" : "Pick a tag"}
            aria-label="Content tag"
          />
          {options.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {options.slice(0, 12).map((t) => (
                <button key={t} type="button" onClick={() => add(t)} className="rounded-full border border-border px-2 py-0.5 text-[12px] text-text-2 hover:bg-surface-3">
                  #{t}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <p className="text-[12px] text-text-3">{locked ? "Only content-tag managers can change tags on this brand." : canCreate ? "You can create new tags." : "Pick from the brand's tag list; managers can add tags."}</p>
    </div>
  );
}

// ---------------------------------------------------------------- best time + hashtags

export function BestTimes({ data, channels, onPick, disabled }: { data: { clicks: Record<string, number[]>; mentions: number[] }; channels: string[]; onPick: (v: string) => void; disabled: boolean }) {
  const [tz, setTz] = useState<number | null>(null);
  useEffect(() => setTz(new Date().getTimezoneOffset()), []);
  const result = useMemo(() => {
    if (tz == null) return null;
    const sum = (arrs: number[][]) => arrs.reduce((acc, a) => acc.map((v, i) => v + (a[i] ?? 0)), new Array(168).fill(0) as number[]);
    const own = sum(channels.map((k) => data.clicks[k]).filter(Boolean));
    const ownSlots = topSlots(localBuckets(own, tz));
    if (ownSlots) return { slots: ownSlots, source: `link clicks on ${channels.length === 1 ? pubChannel(channels[0])?.name : "these channels"}` };
    const all = topSlots(localBuckets(data.clicks.all ?? [], tz));
    if (all) return { slots: all, source: "all tracked link clicks" };
    const m = topSlots(localBuckets(data.mentions, tz), 3, 30);
    if (m) return { slots: m, source: "when your audience posts (listening mentions)" };
    return { slots: null, source: "" };
  }, [data, channels, tz]);
  if (!result) return null;
  return (
    <div className="grid gap-1.5">
      <span className="flex items-center gap-1 text-[13px] font-medium">
        <Clock className="h-3.5 w-3.5" /> Best times to post
      </span>
      {result.slots ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {result.slots.map((s) => (
              <button key={`${s.day}-${s.hour}`} type="button" disabled={disabled} onClick={() => onPick(nextOccurrence(s))} className="rounded-full border border-border-strong px-2.5 py-1 text-[12.5px] hover:bg-surface-3" title={`${Math.round(s.share * 100)}% of activity in this hour`}>
                {slotLabel(s)}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-text-3">From {result.source}, in your time zone. Click to use the next occurrence.</p>
        </>
      ) : (
        <p className="text-[12px] text-text-3">n/a — needs at least 20 tracked link clicks (or 30 listening mentions) to find patterns.</p>
      )}
    </div>
  );
}

export function HashtagChips({ items, draft, onAdd, disabled }: { items: HashtagSuggestion[]; draft: string; onAdd: (tag: string) => void; disabled: boolean }) {
  const used = new Set((draft.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((t) => t.slice(1).toLowerCase()));
  const shown = items.filter((i) => !used.has(i.tag)).slice(0, 12);
  return (
    <div className="grid gap-1.5">
      <span className="flex items-center gap-1 text-[13px] font-medium">
        <Hash className="h-3.5 w-3.5" /> Suggested hashtags
      </span>
      {shown.length ? (
        <div className="flex flex-wrap gap-1.5">
          {shown.map((h) => (
            <button key={h.tag} type="button" disabled={disabled} onClick={() => onAdd(h.tag)} title={`From ${h.source}${h.count > 1 ? ` · seen ${h.count}×` : ""}`} className="rounded-full border border-border px-2 py-0.5 text-[12.5px] text-text-2 hover:bg-surface-3">
              #{h.tag}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-text-3">n/a — suggestions come from listening mentions and your past posts. Add a listening topic to get more.</p>
      )}
    </div>
  );
}
