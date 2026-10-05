"use client";

import { ChevronDown, Copy, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useId, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import type { Topic } from "@/lib/cx/listening/data";
import { LANGUAGE_NAMES, TOPIC_KINDS } from "@/lib/cx/listening/sources";
import { COUNTRIES, FETCH_FREQUENCIES, cleanTerms, displayQuery, splitTerms } from "@/lib/cx/listening/topic-query";
import { cn } from "@/lib/utils";
import { deleteTopicEditorAction, duplicateTopicEditorAction, saveTopicEditorAction } from "./actions";

type SourceInfo = { source: string; name: string; available: boolean; costNote: string; env: string[] };
type Props = { brand: string; topic: Topic | null; sources: SourceInfo[]; defaults: { name: string; keyword: string }; canEdit: boolean; base: string };

/** Chips with × plus an "Add a Keyword" input. Enter, comma or Tab adds; pasting a list splits it; Backspace removes the last chip. */
export function TagInput({ value, onChange, placeholder = "Add a Keyword", label, disabled, max = 300 }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; label: string; disabled?: boolean; max?: number }) {
  const [text, setText] = useState("");
  const id = useId();
  const add = (raw: string) => {
    const terms = splitTerms(raw);
    if (terms.length) onChange(cleanTerms([...value, ...terms], max));
    setText("");
  };
  return (
    <div className={cn("rounded-md border border-border bg-surface-2 p-2", disabled && "opacity-60")} onClick={() => document.getElementById(id)?.focus()}>
      <ul className="flex flex-wrap gap-1.5" aria-label={label}>
        {value.map((v, i) => (
          <li key={`${v}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded bg-brand px-2 py-1 text-[12px] font-semibold tracking-wide text-white">
            <span className="truncate">{v}</span>
            {!disabled && (
              <button type="button" aria-label={`Remove ${v}`} onClick={(e) => { e.stopPropagation(); onChange(value.filter((_, j) => j !== i)); }} className="rounded opacity-80 hover:opacity-100">
                <X className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <input
        id={id}
        aria-label={`${label}: add a keyword`}
        disabled={disabled}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,;\n]/.test(v)) add(v);
          else setText(v);
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === "Tab") && text.trim()) { e.preventDefault(); add(text); }
          else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => text.trim() && add(text)}
        onPaste={(e) => { const t = e.clipboardData.getData("text"); if (/[,;\n]/.test(t)) { e.preventDefault(); add(text + t); } }}
        className="mt-1.5 w-full bg-transparent px-1 py-1 text-[13.5px] text-text outline-none placeholder:text-text-3"
      />
    </div>
  );
}

function Section({ id, title, open, onToggle, children, summary }: { id: string; title: string; open: boolean; onToggle: () => void; children: ReactNode; summary?: string }) {
  return (
    <section id={id} className="rounded-lg border border-border bg-surface shadow-card">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-2 transition-transform", !open && "-rotate-90")} />
        <span className="text-[12px] font-semibold tracking-[0.08em] text-text uppercase">{title}</span>
        {summary && !open && <span className="truncate text-[12px] text-text-3">{summary}</span>}
      </button>
      {open && <div className="space-y-4 border-t border-border px-4 py-4">{children}</div>}
    </section>
  );
}

const Label = ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => <label htmlFor={htmlFor} className="mb-1.5 block text-[12px] font-semibold tracking-[0.08em] text-text uppercase">{children}</label>;
const Help = ({ children }: { children: ReactNode }) => <p className="mt-1.5 text-[12px] text-text-2">{children}</p>;

export function TopicEditor({ brand, topic, sources, defaults, canEdit, base }: Props) {
  const router = useRouter();
  const init = () => ({
    name: topic?.name ?? defaults.name,
    kind: topic?.kind ?? "brand",
    contains: topic?.keywords ?? (defaults.keyword ? [defaults.keyword] : []),
    andContains: topic?.and_contains ?? [],
    excluded: topic?.excluded ?? [],
    sources: (topic?.sources ?? []) as string[],
    languages: topic?.languages ?? [],
    countries: topic?.countries ?? [],
    excludeAuthors: topic?.exclude_authors ?? [],
    excludeSites: topic?.exclude_sites ?? [],
    minFollowers: topic?.min_followers ?? 0,
    verifiedOnly: topic?.verified_only ?? false,
    fetchFrequency: topic?.fetch_frequency ?? "hourly",
    objective: topic?.objective ?? "",
    appIds: topic?.app_ids ?? [],
    active: topic?.active ?? true,
  });
  const [f, setF] = useState(init);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof ReturnType<typeof init>>(k: K, v: ReturnType<typeof init>[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const query = useMemo(() => displayQuery({ contains: f.contains, andContains: f.andContains, excluded: f.excluded }), [f.contains, f.andContains, f.excluded]);
  const href = (id: string) => `${base}&topic=${encodeURIComponent(id)}`;
  const toggleIn = (k: "sources" | "languages" | "countries", v: string) => set(k, f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v]);
  const disabled = !canEdit;

  async function save() {
    setBusy("save"); setError(null); setNotice(null);
    const r = await saveTopicEditorAction(brand, {
      name: f.name, kind: f.kind, keywords: f.contains, excluded: f.excluded, sources: f.sources as never, languages: f.languages, appIds: f.appIds, active: f.active,
      andContains: f.andContains, excludeAuthors: f.excludeAuthors, excludeSites: f.excludeSites, countries: f.countries, minFollowers: Number(f.minFollowers) || 0,
      verifiedOnly: f.verifiedOnly, fetchFrequency: f.fetchFrequency, objective: f.objective,
    }, topic?.id);
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    setNotice(topic ? "Topic saved. Changes apply from the next fetch." : r.data.jobId ? "Topic created. Fetching mentions now." : "Topic created.");
    if (!topic) router.push(href(r.data.id));
    else router.refresh();
  }

  const appstore = f.sources.length === 0 || f.sources.includes("appstore");
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h1 className="min-w-0 text-[22px] font-semibold tracking-tight break-words text-text">{topic ? topic.name : "New topic"}{topic && !topic.active && <Badge className="ml-2 align-middle">Paused</Badge>}</h1>
        <div className="flex items-center gap-2">
          {topic && canEdit && (
            <>
              <Button size="icon" aria-label="Duplicate topic" title="Duplicate topic" loading={busy === "dup"} onClick={async () => { setBusy("dup"); const r = await duplicateTopicEditorAction(brand, topic.id); setBusy(null); if (r.ok) router.push(href(r.data)); else setError(r.error); }}><Copy className="h-4 w-4" /></Button>
              <Button size="icon" aria-label="Delete topic" title="Delete topic" className="text-critical-ink" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" /></Button>
            </>
          )}
          {canEdit && <Link href={href("new")} className="inline-flex h-8.5 items-center gap-1.5 rounded-md bg-good px-3.5 text-[12.5px] font-semibold tracking-[0.06em] text-white uppercase shadow-card hover:opacity-90"><Plus className="h-3.5 w-3.5" />Add new topic</Link>}
        </div>
      </div>
      {error && <Callout tone="critical" className="mb-3">{error}</Callout>}
      {notice && <Callout tone="good" className="mb-3">{notice}</Callout>}
      {!canEdit && <Callout tone="info" className="mb-3">Your role can view topics but not change them.</Callout>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(220px,300px)_1fr]">
        <aside className="min-w-0 lg:sticky lg:top-16 lg:self-start">
          <h2 className="mb-2 text-[17px] font-semibold text-text">Search Query</h2>
          <div className="scroll-thin max-h-[60vh] overflow-y-auto rounded-lg bg-surface-2 p-3 text-[13px] leading-relaxed text-text-2 lg:max-h-[calc(100vh-10rem)]">
            <div className="font-semibold text-text">Your Search Query:</div>
            {query ? <p className="break-words">{query}</p> : <p className="text-text-3">Add CONTAINS keywords to build the query.</p>}
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="space-y-5 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5">
            <div>
              <Label htmlFor="t-name">Topic name</Label>
              <Input id="t-name" value={f.name} disabled={disabled} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Brand name" maxLength={80} />
              <Help>This is a label for &quot;Topic&quot; and is for naming purposes only. This is NOT included in the search term.</Help>
            </div>
            <div>
              <Label>Contains</Label>
              <TagInput label="Contains" value={f.contains} onChange={(v) => set("contains", v)} disabled={disabled} />
              <Help>Include words that <b className="text-text">CONTAINS</b> any of the above keywords (This acts as a primary search. eg: acme, acme corp, acme inc). Advanced: a keyword like <code>acme AND (refund OR delay)</code> is kept as one rule.</Help>
            </div>
            <div>
              <Label>And contains</Label>
              <TagInput label="And contains" value={f.andContains} onChange={(v) => set("andContains", v)} disabled={disabled} max={200} />
              <Help><b className="text-text">AND CONTAINS</b> one or more of the above keywords</Help>
            </div>
            <div>
              <Label>Does not contain</Label>
              <TagInput label="Does not contain" value={f.excluded} onChange={(v) => set("excluded", v)} disabled={disabled} />
              <Help>Ensure content <b className="text-text">DOES NOT CONTAIN</b> any of the above keywords</Help>
            </div>
          </div>

          <Section id="mediapref" title="Media preference (optional)" open={!!open.media} onToggle={() => toggle("media")} summary={f.sources.length ? f.sources.map((s) => sources.find((x) => x.source === s)?.name ?? s).join(", ") : "All sources"}>
            <p className="text-[12.5px] text-text-2">Where to listen. Leave everything unticked to use every source that is available.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {sources.map((s) => (
                <label key={s.source} className="flex items-start gap-2 rounded-md border border-border p-2.5 text-[13px]">
                  <Checkbox checked={f.sources.includes(s.source)} disabled={disabled} onChange={() => toggleIn("sources", s.source)} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5 font-medium text-text">{s.name}{s.available ? <Badge tone="good">Ready</Badge> : <Badge tone="warning">Needs keys</Badge>}</span>
                    <span className="block text-[11.5px] text-text-3">{s.available ? s.costNote : `Set ${s.env.join(", ")} on the server.`}</span>
                  </span>
                </label>
              ))}
            </div>
            {appstore && (
              <div>
                <Label>App Store app ids</Label>
                <TagInput label="App Store app ids" placeholder="1234567890 or gb/1234567890" value={f.appIds} onChange={(v) => set("appIds", v)} disabled={disabled} max={5} />
                <Help>Reviews of these apps are collected when App Store is a source.</Help>
              </div>
            )}
          </Section>

          <Section id="regional" title="Regional (optional)" open={!!open.regional} onToggle={() => toggle("regional")} summary={[f.countries.join(", "), f.languages.join(", ")].filter(Boolean).join(" · ") || "Any country, any language"}>
            <div>
              <Label>Countries</Label>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(COUNTRIES).map(([code, name]) => (
                  <button key={code} type="button" disabled={disabled} aria-pressed={f.countries.includes(code)} onClick={() => toggleIn("countries", code)} className={cn("rounded-full border px-2.5 py-1 text-[12px]", f.countries.includes(code) ? "border-link bg-brand-soft text-link" : "border-border text-text-2 hover:bg-surface-2")}>{name}</button>
                ))}
              </div>
              <Help>Google News is searched in these countries&apos; editions (up to 3). Mentions whose country is known and not listed are skipped.</Help>
            </div>
            <div>
              <Label>Languages</Label>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
                  <button key={code} type="button" disabled={disabled} aria-pressed={f.languages.includes(code)} onClick={() => toggleIn("languages", code)} className={cn("rounded-full border px-2.5 py-1 text-[12px]", f.languages.includes(code) ? "border-link bg-brand-soft text-link" : "border-border text-text-2 hover:bg-surface-2")}>{name}</button>
                ))}
              </div>
              <Help>Only mentions detected in these languages are kept. Leave empty for every language.</Help>
            </div>
          </Section>

          <Section id="exclusions" title="Exclusions (optional)" open={!!open.excl} onToggle={() => toggle("excl")} summary={`${f.excludeAuthors.length} author${f.excludeAuthors.length === 1 ? "" : "s"}, ${f.excludeSites.length} site${f.excludeSites.length === 1 ? "" : "s"}`}>
            <div>
              <Label>Exclude authors</Label>
              <TagInput label="Exclude authors" placeholder="Add an author name or @handle" value={f.excludeAuthors} onChange={(v) => set("excludeAuthors", v)} disabled={disabled} max={200} />
              <Help>Posts by these authors (name or handle) are never collected.</Help>
            </div>
            <div>
              <Label>Exclude sites</Label>
              <TagInput label="Exclude sites" placeholder="Add a domain, e.g. example.com" value={f.excludeSites} onChange={(v) => set("excludeSites", v)} disabled={disabled} max={200} />
              <Help>News and web results from these domains (and their subdomains) are skipped and excluded in the search itself.</Help>
            </div>
          </Section>

          <Section id="more" title="More settings (optional)" open={!!open.more} onToggle={() => toggle("more")} summary={`${FETCH_FREQUENCIES.find((x) => x.id === f.fetchFrequency)?.label ?? ""}${f.minFollowers ? ` · ${f.minFollowers}+ followers` : ""}${f.verifiedOnly ? " · verified only" : ""}`}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="t-freq">Fetch frequency</Label>
                <Select id="t-freq" value={f.fetchFrequency} disabled={disabled} onChange={(e) => set("fetchFrequency", e.target.value)}>
                  {FETCH_FREQUENCIES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </Select>
                <Help>How often new mentions are fetched for this topic. &quot;Fetch now&quot; always runs every active topic.</Help>
              </div>
              <div>
                <Label htmlFor="t-fol">Minimum followers</Label>
                <Input id="t-fol" type="number" min={0} value={f.minFollowers} disabled={disabled} onChange={(e) => set("minFollowers", Math.max(0, Number(e.target.value) || 0))} />
                <Help>Skips authors with fewer followers. Sources that don&apos;t report followers (news, reviews) aren&apos;t filtered.</Help>
              </div>
            </div>
            <label className="flex items-start gap-2 text-[13px] text-text">
              <Checkbox checked={f.verifiedOnly} disabled={disabled} onChange={(e) => set("verifiedOnly", e.target.checked)} className="mt-0.5" />
              <span>Verified authors only<span className="block text-[12px] text-text-2">Drops posts from authors a source reports as not verified (Bluesky verification, Mastodon verified links). Sources without verification data are not filtered.</span></span>
            </label>
          </Section>

          <Section id="objective" title="Objective" open={!!open.obj} onToggle={() => toggle("obj")} summary={TOPIC_KINDS.includes(f.kind) ? `${f.kind[0].toUpperCase()}${f.kind.slice(1)}` : ""}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[220px_1fr]">
              <div>
                <Label htmlFor="t-kind">Type</Label>
                <Select id="t-kind" value={f.kind} disabled={disabled} onChange={(e) => set("kind", e.target.value as typeof f.kind)}>
                  <option value="brand">Brand monitoring</option>
                  <option value="competitor">Competitor</option>
                  <option value="campaign">Campaign</option>
                  <option value="industry">Industry / topic</option>
                </Select>
                <Help>Used for share of voice (brand vs competitors) and crisis detection.</Help>
              </div>
              <div>
                <Label htmlFor="t-obj">What this topic is for</Label>
                <Textarea id="t-obj" rows={3} maxLength={1000} value={f.objective} disabled={disabled} onChange={(e) => set("objective", e.target.value)} placeholder="e.g. Track admissions conversations and complaints during the intake season." />
              </div>
            </div>
          </Section>

          <section className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5 md:grid-cols-2">
            <div>
              <h2 className="text-[17px] font-semibold text-text">Activation</h2>
              <p className="mt-1.5 text-[13px] text-text-2">You can pause a particular Topic if you don&apos;t want to track it for a certain duration. The Topic can later be activated. During the time it is paused, data will not be accumulated.</p>
            </div>
            <div className="flex items-center rounded-lg border border-border p-4">
              <label className="inline-flex cursor-pointer items-center gap-3 text-[13.5px] text-text">
                <span className="relative inline-flex">
                  <input type="checkbox" role="switch" className="peer sr-only" checked={f.active} disabled={disabled} onChange={(e) => set("active", e.target.checked)} />
                  <span className="h-5 w-9 rounded-full bg-border-strong transition-colors peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-link" />
                  <span className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
                </span>
                {f.active ? "Activated" : "Paused"}
              </label>
            </div>
          </section>

          {canEdit && (
            <div className="sticky bottom-0 z-10 flex justify-end gap-2 rounded-lg border border-border bg-surface px-4 py-3 shadow-card">
              <Button variant="ghost" className="tracking-[0.06em] text-link uppercase" onClick={() => { setF(init()); setError(null); setNotice(null); if (!topic) router.push(base); }}>Cancel</Button>
              <Button variant="primary" className="tracking-[0.06em] uppercase" loading={busy === "save"} onClick={save}>Save</Button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} size="sm" title="Delete topic?" description="Its mentions stay but lose their topic; clusters drop it."
        footer={<><Button onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" loading={busy === "del"} onClick={async () => { if (!topic) return; setBusy("del"); const r = await deleteTopicEditorAction(brand, topic.id); setBusy(null); setConfirmDelete(false); if (r.ok) router.push(base); else setError(r.error); }}>Delete</Button></>}>
        <p className="text-[13px] text-text-2">{topic?.name}</p>
      </Dialog>
    </div>
  );
}
