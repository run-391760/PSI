"use client";

import { ChevronDown, GitBranch, MessageCircle, Search, Share2, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { EMPTY_SCOPE, filterOptions, normalizeScope, scopeFromParams, scopeNames, withScopeParam, type ScopeOptions, type ScopeSection, type ScopeValue } from "@/lib/cx/ops/scope-model";
import { cn } from "@/lib/utils";
import { NetworkIcon } from "./network-icon";

export type { ScopeOptions, ScopeValue } from "@/lib/cx/ops/scope-model";

/**
 * Konnect "Topic / Profile" picker: a searchable popover with Select Cluster / Select Topic /
 * Select Profile sections (each with select-all), and a footer with Select All, CLEAR and SAVE.
 * Nothing changes until SAVE; Esc or a click outside discards the draft.
 *
 *   // server page
 *   const options = await scopeOptions(brand.id);           // @/lib/cx/ops/scope
 *   <ScopePicker options={options} />                       // reads/writes ?scope= (router.replace)
 *   // or controlled, without touching the URL:
 *   <ScopePicker options={options} value={v} onChange={setV} sync={false} />
 *
 * With `sync` (default) SAVE writes `?scope=` (and drops `?page=`) so the page re-renders on the server.
 * An empty selection means "all" and removes the parameter.
 */
export function ScopePicker({
  options,
  value,
  onChange,
  sync = true,
  param = "scope",
  placeholder = "All clusters, topics and profiles",
  align = "left",
  className,
}: {
  options: ScopeOptions;
  /** Controlled value; defaults to the URL's `?{param}=`. */
  value?: ScopeValue;
  onChange?: (v: ScopeValue) => void;
  /** Write the saved value to the URL (default true). */
  sync?: boolean;
  param?: string;
  placeholder?: string;
  align?: "left" | "right";
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const current = useMemo(() => value ?? scopeFromParams(new URLSearchParams(search.toString()), param), [value, search, param]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ScopeValue>(current);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), setOpen(false));
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggleOpen = () => {
    if (!open) {
      setDraft(current);
      setQ("");
    }
    setOpen(!open);
  };

  const save = () => {
    const next = normalizeScope(draft);
    setOpen(false);
    onChange?.(next);
    if (sync) {
      const params = withScopeParam(search.toString(), next, param);
      params.delete("page");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  };

  const names = scopeNames(current, options);
  const label = names.length ? names.join(", ") : placeholder;
  const total = options.clusters.length + options.topics.length + options.profiles.length;
  const allIds: ScopeValue = { clusters: options.clusters.map((c) => c.id), topics: options.topics.map((t) => t.id), profiles: options.profiles.map((p) => p.id) };
  const draftCount = draft.clusters.length + draft.topics.length + draft.profiles.length;
  const allChecked = total > 0 && draftCount === total;

  const setSection = (key: ScopeSection, ids: string[]) => setDraft((d) => ({ ...d, [key]: ids }));
  const toggle = (key: ScopeSection, id: string) => setDraft((d) => ({ ...d, [key]: d[key].includes(id) ? d[key].filter((x) => x !== id) : [...d[key], id] }));

  const sections: { key: ScopeSection; title: string; icon: ReactNode; items: { id: string; name: string; icon: ReactNode; hint?: string }[] }[] = [
    { key: "clusters", title: "Select Cluster", icon: <GitBranch className="h-3.5 w-3.5" />, items: filterOptions(options.clusters, q).map((c) => ({ id: c.id, name: c.name, icon: <GitBranch className="h-4 w-4 text-text-3" />, hint: c.isDefault ? "Default" : undefined })) },
    { key: "topics", title: "Select Topic", icon: <MessageCircle className="h-3.5 w-3.5" />, items: filterOptions(options.topics, q).map((t) => ({ id: t.id, name: t.name, icon: <MessageCircle className="h-4 w-4 text-text-3" />, hint: t.active ? undefined : "Paused" })) },
    { key: "profiles", title: "Select Profile", icon: <Share2 className="h-3.5 w-3.5" />, items: filterOptions(options.profiles, q).map((p) => ({ id: p.id, name: p.name, icon: <NetworkIcon kind={p.network} className="h-4 w-4 text-text-3" />, hint: p.type === "source" ? "Listening" : p.status && p.status !== "active" ? p.status : undefined })) },
  ];

  return (
    <div ref={ref} className={cn("relative min-w-0", className)}>
      <button
        type="button"
        onClick={toggleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        title={names.length ? label : undefined}
        className={cn("flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-left text-[13px] hover:border-text-3 focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none", open && "border-brand")}
      >
        <span className={cn("min-w-0 flex-1 truncate", names.length ? "text-text" : "text-text-3")}>{label}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div
          id={listId}
          role="dialog"
          aria-label="Topic / Profile"
          className={cn("absolute z-50 mt-1 flex max-h-[min(480px,calc(100vh-8rem))] w-[min(360px,calc(100vw-2rem))] min-w-full flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-pop", align === "right" ? "right-0" : "left-0")}
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <span className="shrink-0 text-[13.5px] font-semibold text-text">Topic / Profile</span>
            <div className="relative ml-auto min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-text-3" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search"
                aria-label="Search clusters, topics and profiles"
                className="h-7 w-full rounded-md border border-border bg-surface-2 pr-6 pl-7 text-[12.5px] placeholder:text-text-3 focus:border-brand focus:outline-none"
              />
              {q && (
                <button type="button" onClick={() => setQ("")} className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-0.5 text-text-3 hover:text-text" aria-label="Clear search">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {total === 0 && <p className="px-4 py-6 text-center text-[12.5px] text-text-3">No clusters, topics or profiles yet. Connect a channel or add a listening topic first.</p>}
            {sections.map((s) => {
              const ids = options[s.key].map((o) => o.id);
              if (!ids.length) return null;
              const picked = draft[s.key].filter((id) => ids.includes(id)).length;
              const visibleIds = s.items.map((i) => i.id);
              return (
                <section key={s.key} aria-label={s.title}>
                  <label className="sticky top-0 z-[1] flex cursor-pointer items-center gap-2 bg-surface-3 px-3 py-2 text-[12.5px] font-semibold text-text">
                    <span className="text-text-3">{s.icon}</span>
                    <span className="flex-1">{s.title}</span>
                    {picked > 0 && <span className="text-[11px] font-normal text-text-3">{picked}/{ids.length}</span>}
                    <TriCheckbox
                      checked={picked === ids.length}
                      indeterminate={picked > 0 && picked < ids.length}
                      onChange={(on) => setSection(s.key, on ? [...new Set([...draft[s.key], ...(q ? visibleIds : ids)])] : draft[s.key].filter((id) => !(q ? visibleIds : ids).includes(id)))}
                      label={`Select all ${s.key}`}
                    />
                  </label>
                  {s.items.length === 0 ? (
                    <p className="px-3 py-2 text-[12px] text-text-3">No matches</p>
                  ) : (
                    <ul>
                      {s.items.map((i) => (
                        <li key={i.id}>
                          <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-surface-2">
                            <input type="checkbox" checked={draft[s.key].includes(i.id)} onChange={() => toggle(s.key, i.id)} className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--cx-accent,var(--brand))]" />
                            {i.icon}
                            <span className="min-w-0 flex-1 truncate text-[13px] text-text">{i.name}</span>
                            {i.hint && <span className="shrink-0 text-[11px] text-text-3">{i.hint}</span>}
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
          <div className="flex items-center gap-2 border-t border-border px-3 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-text">
              <input type="checkbox" checked={allChecked} disabled={!total} onChange={(e) => setDraft(e.target.checked ? allIds : EMPTY_SCOPE)} className="h-4 w-4 cursor-pointer accent-[var(--cx-accent,var(--brand))]" />
              Select All
            </label>
            <button type="button" onClick={() => setDraft(EMPTY_SCOPE)} className="ml-auto rounded px-2.5 py-1.5 text-[12px] font-semibold tracking-wider text-link uppercase hover:bg-surface-3">
              Clear
            </button>
            <button type="button" onClick={save} className="rounded-md bg-[var(--cx-accent,var(--brand))] px-3.5 py-1.5 text-[12px] font-semibold tracking-wider text-white uppercase hover:opacity-90">
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TriCheckbox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate: boolean; onChange: (on: boolean) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--cx-accent,var(--brand))]" />;
}
