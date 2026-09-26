"use client";

import { type KeyboardEvent, type RefObject, useLayoutEffect, useMemo } from "react";
import { cn } from "@/lib/utils";

export type HighlightRange = { start: number; end: number; kind: "keyword" | "long" | "passive" | "repeat" | "selected" };
const PRIORITY: Record<HighlightRange["kind"], number> = { selected: 5, repeat: 4, keyword: 3, passive: 2, long: 1 };
const CLASS: Record<HighlightRange["kind"], string> = {
  keyword: "bg-brand-soft shadow-[inset_0_-2px_0_var(--brand)]",
  long: "bg-warning-soft",
  passive: "bg-serious-soft",
  repeat: "bg-critical-soft",
  selected: "bg-info-soft outline outline-2 outline-link",
};

/** Split text into segments with the highest-priority highlight kind covering each. */
function segments(text: string, ranges: HighlightRange[]) {
  const valid = ranges.filter((r) => r.end > r.start && r.start < text.length);
  if (!valid.length) return [{ text, kind: null as HighlightRange["kind"] | null, start: 0 }];
  const points = new Set<number>([0, text.length]);
  for (const r of valid) {
    points.add(Math.max(0, r.start));
    points.add(Math.min(text.length, r.end));
  }
  const sorted = [...points].sort((a, b) => a - b);
  const byStart = [...valid].sort((a, b) => a.start - b.start);
  const out: { text: string; kind: HighlightRange["kind"] | null; start: number }[] = [];
  let active: HighlightRange[] = [];
  let idx = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i],
      b = sorted[i + 1];
    while (idx < byStart.length && byStart[idx].start <= a) active.push(byStart[idx++]);
    active = active.filter((r) => r.end > a);
    const kind = active.reduce<HighlightRange["kind"] | null>((best, r) => (!best || PRIORITY[r.kind] > PRIORITY[best] ? r.kind : best), null);
    const prev = out[out.length - 1];
    if (prev && prev.kind === kind) prev.text += text.slice(a, b);
    else out.push({ text: text.slice(a, b), kind, start: a });
  }
  return out;
}

const SHARED = "px-5 py-4 text-[15px] leading-[1.75] whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-sans tracking-normal";

/**
 * Plain <textarea> with a pixel-aligned backdrop that renders highlight marks behind the text.
 * The textarea grows with its content so the backdrop never needs scroll syncing.
 */
export function HighlightedTextarea({
  value,
  onChange,
  ranges,
  textareaRef,
  onKeyDown,
  placeholder,
  minHeight = 420,
}: {
  value: string;
  onChange: (v: string) => void;
  ranges: HighlightRange[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const segs = useMemo(() => segments(value, ranges), [value, ranges]);
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`;
  }, [value, textareaRef, minHeight]);
  return (
    <div className="relative">
      <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden border border-transparent text-transparent", SHARED)}>
        {segs.map((s, i) =>
          s.kind ? (
            <mark key={i} id={s.kind === "selected" ? "wa-selected" : undefined} className={cn("rounded-[3px] text-transparent", CLASS[s.kind])}>
              {s.text}
            </mark>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
        {"\n "}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        spellCheck
        aria-label="Document text"
        className={cn("relative block w-full resize-none overflow-hidden border border-transparent bg-transparent text-text caret-text placeholder:text-text-3 outline-none", SHARED)}
        style={{ minHeight }}
      />
    </div>
  );
}
