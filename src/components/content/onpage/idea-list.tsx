"use client";

import { BarChart3, Check, FlaskConical, Radio, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { toggleIdeaAction } from "@/app/(app)/on-page-checker/actions";
import type { Idea, IdeaSource, IdeaType } from "@/lib/content/ideas";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Segmented } from "@/components/ui/tabs";

const PRIORITY = { high: { tone: "critical", label: "High" }, medium: { tone: "warning", label: "Medium" }, low: { tone: "neutral", label: "Low" } } as const;

const SOURCE_TAGS: Record<IdeaSource, { label: string; title: string; cls: string; Icon: typeof Radio }> = {
  live: { label: "Live page", title: "Based on the page we fetched from your live site.", cls: "text-good-ink", Icon: Radio },
  serp: { label: "Top 10", title: "Based on the live Google top 10 (DataForSEO) and those pages crawled for comparison.", cls: "text-link", Icon: Search },
  gsc: { label: "Search Console", title: "Based on your Search Console data for this page (last 28 days).", cls: "text-brand-ink", Icon: BarChart3 },
  demo: { label: "Demo data", title: "Based on the demo engine — synthetic, not measured.", cls: "text-warning-ink", Icon: FlaskConical },
};

export function SourceTag({ source }: { source: IdeaSource }) {
  const t = SOURCE_TAGS[source] ?? SOURCE_TAGS.live;
  return (
    <span className={cn("inline-flex cursor-help items-center gap-1 text-[11.5px] font-medium", t.cls)} title={t.title}>
      <t.Icon className="h-3 w-3" /> {t.label}
    </span>
  );
}

export function IdeaList({ ideas, done, projectId, targetId, types }: { ideas: Idea[]; done: string[]; projectId: string; targetId: string; types: { id: IdeaType; label: string; description: string }[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [optimisticDone, setDone] = useOptimistic(new Set(done), (state, action: { id: string; done: boolean }) => {
    const next = new Set(state);
    if (action.done) next.add(action.id);
    else next.delete(action.id);
    return next;
  });
  const [filter, setFilter] = useState<"open" | "all" | "done">("open");
  const toggle = (id: string, value: boolean) =>
    start(async () => {
      setDone({ id, done: value });
      await toggleIdeaAction(projectId, targetId, id, value);
      router.refresh();
    });
  const visible = ideas.filter((i) => (filter === "all" ? true : filter === "done" ? optimisticDone.has(i.id) : !optimisticDone.has(i.id)));
  const openCount = ideas.filter((i) => !optimisticDone.has(i.id)).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] text-text-2">
          <span className="font-semibold text-text">{openCount}</span> open of {ideas.length} ideas · mark ideas done as you implement them
        </div>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "open", label: `Open (${openCount})` },
            { value: "done", label: `Done (${ideas.length - openCount})` },
            { value: "all", label: "All" },
          ]}
        />
      </div>
      {types.map((t) => {
        const list = visible.filter((i) => i.type === t.id);
        if (!list.length) return null;
        return (
          <Card key={t.id} id={`type-${t.id}`}>
            <CardHeader title={`${t.label} ideas`} description={t.description} actions={<Badge>{list.length}</Badge>} />
            <ul className="divide-y divide-border border-t border-border">
              {list.map((idea) => {
                const isDone = optimisticDone.has(idea.id);
                const p = PRIORITY[idea.priority];
                return (
                  <li key={idea.id} className={cn("flex gap-3 px-4 py-3", isDone && "opacity-60")}>
                    <button
                      type="button"
                      onClick={() => toggle(idea.id, !isDone)}
                      className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors", isDone ? "border-good bg-good text-white" : "border-border-strong hover:border-brand")}
                      aria-label={isDone ? "Mark as not done" : "Mark as done"}
                      aria-pressed={isDone}
                    >
                      {isDone && <Check className="h-3.5 w-3.5" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className={cn("text-[13.5px] font-medium text-text", isDone && "line-through")}>{idea.title}</span>
                        <Badge tone={p.tone}>{p.label}</Badge>
                        <SourceTag source={idea.source} />
                      </div>
                      <p className="mt-1 text-[13px] leading-relaxed text-text-2">{idea.detail}</p>
                      {idea.items && idea.items.length > 0 && (
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                          {idea.items.map((it) => (
                            <li key={it} className="max-w-full truncate rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[12px] text-text-2">
                              {it}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
      {visible.length === 0 && (
        <Card>
          <p className="px-4 py-10 text-center text-[13px] text-text-3">{filter === "done" ? "No ideas marked done yet." : "All ideas for this page are done. Recollect ideas to check the updated page."}</p>
        </Card>
      )}
    </div>
  );
}
