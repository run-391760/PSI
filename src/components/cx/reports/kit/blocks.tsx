"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { dmy, SENTIMENT_LABEL, type DrillSpec, type Sentiment } from "@/lib/cx/reports/model";
import { mediaLabel } from "@/lib/cx/ops/model";
import { NetworkAvatar } from "./avatar";
import { useReport, useSeriesToggle } from "./context";

/** % change with a red-down / green-up arrow (direction meaning flips with `upIsGood`). "n/a" when unknown. */
export function Change({ value, upIsGood = true, className }: { value: number | null | undefined; upIsGood?: boolean; className?: string }) {
  if (value == null || !Number.isFinite(value)) return <span className={cn("text-[12.5px] text-text-3", className)} title="No previous period to compare">n/a</span>;
  const up = value >= 0;
  const good = up === upIsGood;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[13px] font-medium tabular", good ? "text-good-ink" : "text-critical-ink", className)} title="Change vs the previous equal period">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {up ? "" : "-"}
      {Math.abs(value).toFixed(2)} %<span className="sr-only">{up ? " up" : " down"}</span>
    </span>
  );
}

export type Tile = {
  key: string;
  label: string;
  value: ReactNode;
  change?: number | null;
  upIsGood?: boolean;
  badge?: string;
  badgeTone?: "good" | "critical" | "neutral";
  /** Shared series key (e.g. "negative"): the tile dims when that series is toggled off. */
  seriesKey?: string;
  drill?: DrillSpec | null;
  info?: string;
};

/** Row of clickable KPI tiles (each opens the drawer). */
export function TileRow({ tiles, cols = 4, center, size = "lg" }: { tiles: Tile[]; cols?: 2 | 3 | 4 | 5 | 6; center?: boolean; size?: "lg" | "md" }) {
  const { openDrill } = useReport();
  const { hidden } = useSeriesToggle(true);
  const grid = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 xl:grid-cols-4", 5: "sm:grid-cols-3 xl:grid-cols-5", 6: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6" }[cols];
  return (
    <div className={cn("grid gap-3", cols === 6 ? "" : "grid-cols-1", grid)}>
      {tiles.map((t) => {
        const off = t.seriesKey ? hidden.has(t.seriesKey) : false;
        const click = t.drill ? () => openDrill(t.drill!) : undefined;
        return (
          <button
            key={t.key}
            type="button"
            onClick={click}
            disabled={!click}
            title={t.info ?? (click ? "Click to see the items" : undefined)}
            className={cn(
              "min-w-0 rounded-lg border border-border bg-surface px-4 py-3.5 text-left shadow-card transition-opacity",
              click && "hover:border-border-strong hover:bg-surface-2",
              center && "text-center",
              off && "opacity-40",
            )}
          >
            <div className={cn("flex items-start gap-2", center ? "justify-center" : "justify-between")}>
              <span className={cn("tabular font-light text-text", size === "lg" ? "text-[30px] leading-9" : "text-[24px] leading-8")}>{t.value}</span>
              {!center && (
                <span className="flex flex-col items-end gap-1">
                  {t.change !== undefined && <Change value={t.change} upIsGood={t.upIsGood} />}
                  {t.badge && (
                    <span className={cn("max-w-36 truncate rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase", t.badgeTone === "good" ? "border-transparent bg-good-soft text-good-ink" : t.badgeTone === "critical" ? "border-transparent bg-critical-soft text-critical-ink" : "border-border text-text-2")}>
                      {t.badge}
                    </span>
                  )}
                </span>
              )}
            </div>
            <div className="mt-1 text-[11.5px] font-medium tracking-[0.08em] text-text-2 uppercase">{t.label}</div>
          </button>
        );
      })}
    </div>
  );
}

/** Stats column next to a chart (scope name, then big values with small uppercase labels). */
export function StatsColumn({ title, items }: { title?: ReactNode; items: { label: string; value: ReactNode; drill?: DrillSpec | null }[] }) {
  const { openDrill } = useReport();
  return (
    <div className="min-w-0">
      {title && <div className="mb-3 border-b border-border pb-3 text-[20px] font-semibold text-text">{title}</div>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-1">
        {items.map((i) => (
          <div key={i.label} className="min-w-0">
            <dt className="order-2 mt-0.5 text-[11px] font-medium tracking-[0.08em] text-text-2 uppercase">{i.label}</dt>
            <dd className="text-[20px] font-semibold text-text tabular">
              {i.drill ? (
                <button type="button" onClick={() => openDrill(i.drill!)} className="hover:text-link hover:underline" title="Click to see the items">
                  {i.value}
                </button>
              ) : (
                i.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Word cloud with MOST USED WORDS chips; every word opens the drawer filtered to conversations containing it. */
export function WordCloudK({ words, tone = "neutral", drill, empty = "Not enough text in this period." }: { words: { word: string; count: number }[]; tone?: Sentiment; drill: Omit<DrillSpec, "title" | "word"> & { titlePrefix?: string }; empty?: string }) {
  const { openDrill } = useReport();
  if (!words.length) return <p className="py-12 text-center text-[13px] text-text-3">{empty}</p>;
  const max = words[0].count, min = words[words.length - 1].count;
  const size = (c: number) => (max === min ? 15 : 12 + ((c - min) / (max - min)) * 14);
  // Shuffle deterministically so big words don't all cluster at the start.
  const shown = [...words].sort((a, b) => ((a.word.charCodeAt(0) * 7 + a.word.length) % 11) - ((b.word.charCodeAt(0) * 7 + b.word.length) % 11));
  const toneCls = tone === "positive" ? "text-good-ink" : tone === "negative" ? "text-critical-ink" : "text-link";
  const chipCls = tone === "positive" ? "bg-good-soft text-good-ink" : tone === "negative" ? "bg-critical-soft text-critical-ink" : "bg-brand-soft text-brand-ink";
  const { titlePrefix, ...base } = drill;
  const open = (w: string) => openDrill({ ...base, word: w, title: [titlePrefix, `“${w}”`].filter(Boolean).join(" · ") });
  return (
    <div>
      <div className="flex min-h-40 flex-wrap items-center justify-center gap-x-3 gap-y-1 px-2 py-3">
        {shown.map((w, i) => (
          <button key={w.word} type="button" onClick={() => open(w.word)} className={cn("leading-tight hover:underline", i % 3 === 0 ? "text-text" : toneCls)} style={{ fontSize: size(w.count), fontWeight: w.count >= (max + min) / 2 ? 600 : 400 }} title={`${w.count.toLocaleString("en-US")} conversations`}>
            {w.word}
          </button>
        ))}
      </div>
      <div className="mt-2 border-t border-border pt-3">
        <div className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-text-2 uppercase">Most used words</div>
        <div className="flex flex-wrap gap-2">
          {words.slice(0, 3).map((w) => (
            <button key={w.word} type="button" onClick={() => open(w.word)} className={cn("rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold hover:opacity-80", chipCls)}>
              {w.word} <span className="font-normal opacity-80">{w.count.toLocaleString("en-US")}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export type KCell = { v: ReactNode; drill?: DrillSpec | null; align?: "left" | "right" };
/** Table whose cells open the drawer when they carry a drill spec. */
export function DrillTableK({ columns, rows, empty = "No data for this period.", highlightLast }: { columns: { label: string; align?: "left" | "right" }[]; rows: KCell[][]; empty?: string; highlightLast?: boolean }) {
  const { openDrill } = useReport();
  if (!rows.length) return <p className="py-10 text-center text-[13px] text-text-3">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-[13px]">
        <thead>
          <tr className="border-b border-border text-[11px] font-semibold tracking-wide text-text-2 uppercase">
            {columns.map((c, i) => <th key={i} className={cn("px-2 py-2 font-semibold", (c.align ?? (i ? "right" : "left")) === "right" ? "text-right" : "text-left")}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={cn("border-b border-border last:border-0", highlightLast && i === rows.length - 1 && "bg-surface-2")}>
              {r.map((c, j) => {
                const right = (c.align ?? columns[j]?.align ?? (j ? "right" : "left")) === "right";
                return (
                  <td key={j} className={cn("px-2 py-2.5", right ? "text-right tabular" : "text-left font-medium text-text", j && "text-text-2")}>
                    {c.drill ? (
                      <button type="button" onClick={() => openDrill(c.drill!)} className="hover:text-link hover:underline" title="Click to see the items">
                        {c.v}
                      </button>
                    ) : (
                      c.v
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type PostRow = { id: string; author: string; handle: string | null; avatar: string | null; network: string; mediaType: string; sentiment: Sentiment; text: string; title: string; at: string; url: string | null };
/** Top posts list (scrolls); a row opens the drawer on that conversation (from there: ticket view or create ticket). */
export function PostListK({ posts, drill, empty = "No posts in this period." }: { posts: PostRow[]; drill: Omit<DrillSpec, "title" | "item">; empty?: string }) {
  const { openDrill } = useReport();
  if (!posts.length) return <p className="py-12 text-center text-[13px] text-text-3">{empty}</p>;
  return (
    <ul className="max-h-[380px] divide-y divide-border overflow-y-auto pr-1">
      {posts.map((p) => (
        <li key={p.id}>
          <button type="button" onClick={() => openDrill({ ...drill, item: p.id, title: `${SENTIMENT_LABEL[p.sentiment]} · ${p.author}` })} className="flex w-full gap-3 py-2.5 text-left hover:bg-surface-2">
            <NetworkAvatar name={p.author} src={p.avatar} network={p.network} size={34} />
            <span className="min-w-0 flex-1">
              <span className="flex items-start gap-2">
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-text">{p.author}</span>
                <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold", p.sentiment === "positive" ? "bg-good-soft text-good-ink" : p.sentiment === "negative" ? "bg-critical-soft text-critical-ink" : "bg-surface-3 text-text-2")}>{SENTIMENT_LABEL[p.sentiment]}</span>
                <span className="shrink-0 text-[12.5px] text-link">{dmy(p.at)}</span>
              </span>
              <span className="mt-0.5 line-clamp-2 text-[13px] break-words text-text-2">{p.title && p.title !== p.text ? `${p.title} — ${p.text}` : p.text}</span>
              <span className="mt-0.5 block text-[11.5px] text-text-3">{mediaLabel(p.mediaType)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
