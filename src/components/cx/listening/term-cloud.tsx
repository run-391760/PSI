import { cn } from "@/lib/utils";

/** Word cloud of top terms: size by document frequency, color by dominant sentiment (with legend). */
export function TermCloud({ terms }: { terms: { term: string; count: number; tone: string }[] }) {
  if (!terms.length) return <div className="px-4 py-8 text-center text-[13px] text-text-3">Not enough text yet.</div>;
  const max = Math.max(...terms.map((t) => t.count));
  const min = Math.min(...terms.map((t) => t.count));
  const size = (c: number) => (max === min ? 16 : 12 + ((c - min) / (max - min)) * 16);
  const sorted = [...terms].sort((a, b) => a.term.localeCompare(b.term));
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1.5 px-4 py-3">
        {sorted.map((t) => (
          <span
            key={t.term}
            title={`${t.term}: ${t.count} mentions (${t.tone})`}
            style={{ fontSize: `${size(t.count).toFixed(1)}px` }}
            className={cn("leading-tight font-medium", t.tone === "negative" ? "text-critical-ink" : t.tone === "positive" ? "text-good-ink" : "text-text-2")}
          >
            {t.term}
          </span>
        ))}
      </div>
      <div className="flex justify-center gap-4 pb-3 text-[11.5px] text-text-3">
        <span className="text-good-ink">Mostly positive</span>
        <span>Mixed / neutral</span>
        <span className="text-critical-ink">Mostly negative</span>
      </div>
    </div>
  );
}
