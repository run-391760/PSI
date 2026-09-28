"use client";

import { useRouter } from "next/navigation";
import { cloneElement, isValidElement, useId, useState, type ReactElement, type ReactNode } from "react";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field as KitField, Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Run a server action, keep busy/error/notice state and refresh the page on success. */
export function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function run<T>(key: string, p: Promise<Result<T>> | (() => Promise<Result<T>>), done?: (d: T) => string | void) {
    setBusy(key); setError(null); setNotice(null);
    try {
      const r = await (typeof p === "function" ? p() : p);
      if (!r.ok) { setError(r.error); return null; }
      const msg = done?.(r.data);
      if (msg) setNotice(msg);
      router.refresh();
      return r.data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return null;
    } finally {
      setBusy(null);
    }
  }
  const messages = (
    <>
      {error && <Callout tone="critical" className="mb-3">{error}</Callout>}
      {notice && <Callout tone="good" className="mb-3">{notice}</Callout>}
    </>
  );
  return { run, busy, error, setError, notice, setNotice, messages };
}

/** Comma-separated list input bound to a string[] value. */
export function ListInput({ value, onChange, placeholder, className, id }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; className?: string; id?: string }) {
  const [text, setText] = useState(value.join(", "));
  return <Input id={id} className={className} value={text} placeholder={placeholder} onChange={(e) => { setText(e.target.value); onChange(e.target.value.split(",").map((x) => x.trim()).filter(Boolean)); }} />;
}

export function CheckRow({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("flex items-start gap-2 text-[13px] text-text", disabled && "opacity-60")}>
      <Checkbox checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span>{label}{hint && <span className="block text-[12px] text-text-3">{hint}</span>}</span>
    </label>
  );
}

/** Read a local file as text (CSV imports). */
export function FileButton({ label, accept = ".csv,.tsv,.txt", onText, className }: { label: ReactNode; accept?: string; onText: (t: string) => void; className?: string }) {
  return (
    <label className={cn("inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 text-[12.5px] font-medium text-text shadow-card hover:bg-surface-3", className)}>
      {label}
      <input type="file" accept={accept} className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) onText(await f.text()); e.target.value = ""; }} />
    </label>
  );
}

export function downloadText(filename: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Kit Field that ties its label to the single child control (generated id), so labels are clickable and accessible. */
export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  const auto = useId();
  const child = isValidElement(children) ? (children as ReactElement<{ id?: string }>) : null;
  const id = child?.props.id ?? auto;
  return <KitField label={label} hint={hint} error={error} className={className} htmlFor={child ? id : undefined}>{child ? cloneElement(child, { id }) : children}</KitField>;
}

/** A timestamp in the viewer's locale/time zone. Server and browser format differently, so hydration warnings are suppressed. */
export function When({ iso, time, fallback = "never" }: { iso: string | null | undefined; time?: boolean; fallback?: string }) {
  if (!iso) return <>{fallback}</>;
  const d = new Date(iso);
  return <time dateTime={iso} suppressHydrationWarning>{time ? d.toLocaleTimeString() : d.toLocaleString()}</time>;
}
/** Text that depends on the current time (elapsed timers); may differ by a minute between server and browser. */
export const Live = ({ children }: { children: ReactNode }) => <span suppressHydrationWarning>{children}</span>;
