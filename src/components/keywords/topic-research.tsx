"use client";

import { ChevronDown, ChevronUp, Link2, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { removeFavoriteAction, toggleFavoriteAction } from "@/app/(app)/topic-research/actions";
import { compact, dateLabel } from "@/lib/format";
import type { Favorite, Subtopic, TopicIdea } from "@/lib/keywords/topics";
import { cn } from "@/lib/utils";
import { DomainAvatar, KdBadge, KeywordLink } from "@/components/seo/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Callout } from "@/components/ui/feedback";
import { Segmented } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";

const favKey = (kind: string, text: string) => `${kind}|${text}`;

/** Optimistic favorites for one topic. */
function useFavorites(initial: string[], topic: string, db: string) {
  const router = useRouter();
  const [set, setSet] = useState(() => new Set(initial));
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const toggle = useCallback(
    (kind: string, text: string, subtopic?: string) => {
      const key = favKey(kind, text);
      setSet((s) => {
        const next = new Set(s);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      start(async () => {
        const res = await toggleFavoriteAction({ topic, db, kind, text, subtopic });
        if (!res.ok) {
          setError(res.error);
          setSet((s) => {
            const next = new Set(s);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          });
        } else router.refresh();
      });
    },
    [topic, db, router],
  );
  return { has: (kind: string, text: string) => set.has(favKey(kind, text)), toggle, error };
}
type Fav = ReturnType<typeof useFavorites>;

function StarButton({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} aria-label={on ? `Remove “${label}” from favorites` : `Save “${label}” to favorites`} title={on ? "Remove from favorites" : "Save to favorites"} className={cn("shrink-0 rounded p-0.5 transition-colors", on ? "text-warning" : "text-text-3 hover:text-text")}>
      <Star className="h-3.5 w-3.5" fill={on ? "currentColor" : "none"} />
    </button>
  );
}

const ORIGIN: Record<TopicIdea["origin"], string> = { serp: "Ranking page title", template: "Generated headline idea", autocomplete: "Real Google Autocomplete suggestion", database: "From the keyword database" };

function IdeaRow({ idea, fav, subtopic, db }: { idea: TopicIdea; fav: Fav; subtopic?: string; db: string }) {
  return (
    <li className="flex items-start gap-2 py-1.5 text-[13px]">
      <StarButton on={fav.has(idea.kind, idea.text)} onClick={() => fav.toggle(idea.kind, idea.text, subtopic)} label={idea.text} />
      <div className="min-w-0 flex-1">
        {idea.kind === "related" ? <KeywordLink keyword={idea.text} db={db} /> : <span className="text-text">{idea.text}</span>}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-text-3">
          {idea.domain && (
            <Link href={`/domain-overview?q=${encodeURIComponent(idea.domain)}&db=${db}`} className="inline-flex items-center gap-1 hover:text-link">
              <DomainAvatar domain={idea.domain} size={13} /> {idea.domain}
            </Link>
          )}
          {idea.backlinks != null && (
            <span className="inline-flex items-center gap-0.5">
              <Link2 className="h-3 w-3" /> {compact(idea.backlinks)} backlinks
            </span>
          )}
          {idea.volume != null && idea.kind !== "headline" && <span>{compact(idea.volume)} searches</span>}
          {idea.origin === "autocomplete" && <span className="rounded bg-good-soft px-1 text-[10px] font-semibold text-good-ink">AC</span>}
          {idea.origin === "template" && <Tooltip content={ORIGIN.template}><span className="rounded bg-surface-3 px-1 text-[10px] font-semibold text-text-2">Idea</span></Tooltip>}
        </div>
      </div>
    </li>
  );
}

function EfficiencyBadge({ s }: { s: Subtopic }) {
  const tone = s.efficiencyLabel === "High" ? "good" : s.efficiencyLabel === "Medium" ? "warning" : "neutral";
  return (
    <Badge tone={tone} title="Topic efficiency: search volume relative to difficulty, compared with the other subtopics." className="shrink-0">
      {s.efficiencyLabel} efficiency
    </Badge>
  );
}

/** Cards view: one card per subtopic; expanding shows headlines, questions and related searches. */
export function TopicCards({ subtopics, topic, db, favorites }: { subtopics: Subtopic[]; topic: string; db: string; favorites: string[] }) {
  const fav = useFavorites(favorites, topic, db);
  const [sort, setSort] = useState<"volume" | "difficulty" | "efficiency">("volume");
  const [open, setOpen] = useState<string | null>(null);
  const sorted = useMemo(
    () =>
      [...subtopics].sort((a, b) =>
        sort === "volume" ? b.volume - a.volume : sort === "difficulty" ? (a.difficulty ?? 101) - (b.difficulty ?? 101) : b.efficiency - a.efficiency,
      ),
    [subtopics, sort],
  );
  return (
    <div>
      {fav.error && <Callout tone="critical" className="mb-3">{fav.error}</Callout>}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-text-2">{subtopics.length} subtopics · click “Show ideas” for headlines, questions and related searches · ★ saves an idea</p>
        <Segmented
          options={[
            { value: "volume", label: "By volume" },
            { value: "difficulty", label: "By difficulty" },
            { value: "efficiency", label: "By efficiency" },
          ]}
          value={sort}
          onChange={setSort}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sorted.map((s) => {
          const expanded = open === s.id;
          return (
            <section key={s.id} className={cn("flex flex-col rounded-lg border bg-surface shadow-card", expanded ? "border-brand/40 md:col-span-2 xl:col-span-3" : "border-border")}>
              <header className="flex items-start gap-2 px-4 pt-3.5 pb-2">
                <div className="min-w-0 flex-1">
                  <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-text">
                    <span className="truncate">{s.name}</span>
                    <StarButton on={fav.has("subtopic", s.name)} onClick={() => fav.toggle("subtopic", s.name, s.name)} label={s.name} />
                  </h3>
                  <KeywordLink keyword={s.keyword} db={db} className="text-[12.5px]" />
                </div>
                <EfficiencyBadge s={s} />
              </header>
              <div className="mx-4 grid grid-cols-3 gap-2 rounded-md bg-surface-2 px-3 py-2 text-[12px]">
                <div>
                  <div className="text-text-3">Volume</div>
                  <div className="tabular text-[14px] font-semibold text-text">{compact(s.volume)}</div>
                </div>
                <div>
                  <div className="text-text-3">Difficulty</div>
                  <div className="text-[14px] font-semibold">{s.difficulty == null ? "n/a" : <KdBadge kd={s.difficulty} />}</div>
                </div>
                <div>
                  <div className="text-text-3">Keywords</div>
                  <div className="tabular text-[14px] font-semibold text-text">{s.keywords}</div>
                </div>
              </div>
              {expanded ? (
                <div className="grid gap-4 px-4 pt-3 pb-2 md:grid-cols-3">
                  <IdeaColumn title="Headlines" ideas={s.headlines} fav={fav} subtopic={s.name} db={db} />
                  <IdeaColumn title="Questions" ideas={s.questions} fav={fav} subtopic={s.name} db={db} />
                  <IdeaColumn title="Related searches" ideas={s.related} fav={fav} subtopic={s.name} db={db} />
                </div>
              ) : (
                <ul className="flex-1 divide-y divide-border px-4 pt-1.5">
                  {s.headlines.slice(0, 3).map((h) => (
                    <IdeaRow key={h.text} idea={h} fav={fav} subtopic={s.name} db={db} />
                  ))}
                </ul>
              )}
              <footer className="mt-auto flex items-center justify-between border-t border-border px-4 py-2">
                <span className="text-[12px] text-text-3">
                  {s.headlines.length} headlines · {s.questions.length} questions · {s.related.length} related
                </span>
                <Button size="sm" variant="ghost" onClick={() => setOpen(expanded ? null : s.id)} aria-expanded={expanded}>
                  {expanded ? (
                    <>
                      Show less <ChevronUp className="h-3.5 w-3.5" />
                    </>
                  ) : (
                    <>
                      Show ideas <ChevronDown className="h-3.5 w-3.5" />
                    </>
                  )}
                </Button>
              </footer>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function IdeaColumn({ title, ideas, fav, subtopic, db }: { title: string; ideas: TopicIdea[]; fav: Fav; subtopic: string; db: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11.5px] font-semibold tracking-wide text-text-3 uppercase">
        {title} <span className="font-normal">{ideas.length}</span>
      </div>
      {ideas.length ? (
        <ul className="divide-y divide-border">
          {ideas.map((i) => (
            <IdeaRow key={i.text} idea={i} fav={fav} subtopic={subtopic} db={db} />
          ))}
        </ul>
      ) : (
        <p className="py-3 text-[12.5px] text-text-3">None found.</p>
      )}
    </div>
  );
}

/** Overview cards (top headlines / interesting questions / related searches) with favorites. */
export function IdeaListCard({ ideas, topic, db, favorites, empty }: { ideas: TopicIdea[]; topic: string; db: string; favorites: string[]; empty: string }) {
  const fav = useFavorites(favorites, topic, db);
  return ideas.length ? (
    <ul className="divide-y divide-border">
      {ideas.map((i) => (
        <IdeaRow key={i.text} idea={i} fav={fav} db={db} />
      ))}
    </ul>
  ) : (
    <p className="py-6 text-center text-[13px] text-text-3">{empty}</p>
  );
}

type ExplorerRow = { subtopic: string; subtopicVolume: number; difficulty: number | null; idea: TopicIdea };

/** Explorer view: every idea in one sortable, exportable table. */
export function TopicExplorer({ subtopics, topic, db, favorites }: { subtopics: Subtopic[]; topic: string; db: string; favorites: string[] }) {
  const fav = useFavorites(favorites, topic, db);
  const [kind, setKind] = useState<"all" | "headline" | "question" | "related">("all");
  const rows = useMemo<ExplorerRow[]>(
    () => subtopics.flatMap((s) => [...s.headlines, ...s.questions, ...s.related].filter((i) => kind === "all" || i.kind === kind).map((idea) => ({ subtopic: s.name, subtopicVolume: s.volume, difficulty: s.difficulty, idea }))),
    [subtopics, kind],
  );
  const columns: Column<ExplorerRow>[] = [
    { key: "star", header: "", sortable: false, noExport: true, width: "32px", render: (r) => <StarButton on={fav.has(r.idea.kind, r.idea.text)} onClick={() => fav.toggle(r.idea.kind, r.idea.text, r.subtopic)} label={r.idea.text} /> },
    { key: "idea", header: "Idea", sortValue: (r) => r.idea.text, csv: (r) => r.idea.text, render: (r) => (r.idea.kind === "related" ? <KeywordLink keyword={r.idea.text} db={db} /> : <span className="text-text">{r.idea.text}</span>) },
    { key: "kind", header: "Type", sortValue: (r) => r.idea.kind, csv: (r) => r.idea.kind, render: (r) => <Badge>{r.idea.kind === "headline" ? "Headline" : r.idea.kind === "question" ? "Question" : "Related search"}</Badge> },
    { key: "subtopic", header: "Subtopic", sortValue: (r) => r.subtopic },
    { key: "origin", header: "Source", sortValue: (r) => r.idea.origin, csv: (r) => ORIGIN[r.idea.origin], render: (r) => <span className="text-[12px] whitespace-nowrap text-text-2">{r.idea.origin === "autocomplete" ? "Google Autocomplete" : r.idea.origin === "serp" ? `Top 10: ${r.idea.domain}` : r.idea.origin === "template" ? "Idea generator" : "Keyword database"}</span> },
    { key: "volume", header: "Searches", align: "right", sortValue: (r) => r.idea.volume, render: (r) => (r.idea.volume == null || r.idea.kind === "headline" ? <span className="text-text-3">–</span> : compact(r.idea.volume)), csv: (r) => (r.idea.kind === "headline" ? "" : r.idea.volume) },
    { key: "backlinks", header: "Backlinks", align: "right", sortValue: (r) => r.idea.backlinks, render: (r) => (r.idea.backlinks == null ? <span className="text-text-3">–</span> : compact(r.idea.backlinks)), csv: (r) => r.idea.backlinks },
    { key: "subtopicVolume", header: "Subtopic vol.", align: "right", render: (r) => compact(r.subtopicVolume) },
    { key: "difficulty", header: "Difficulty", align: "right", sortValue: (r) => r.difficulty, render: (r) => <KdBadge kd={r.difficulty} /> },
  ];
  return (
    <div className="rounded-lg border border-border bg-surface pt-3.5 shadow-card">
      {fav.error && <Callout tone="critical" className="mx-4 mb-3">{fav.error}</Callout>}
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r, i) => `${r.subtopic}|${r.idea.kind}|${r.idea.text}|${i}`}
        defaultSort={{ key: "subtopicVolume", dir: "desc" }}
        pageSize={50}
        searchable
        searchPlaceholder="Filter ideas"
        searchText={(r) => `${r.idea.text} ${r.subtopic}`}
        exportName={`topic-research_${topic.replace(/\s+/g, "-")}_${db}`}
        toolbar={
          <Segmented
            options={[
              { value: "all", label: "All" },
              { value: "headline", label: "Headlines" },
              { value: "question", label: "Questions" },
              { value: "related", label: "Related" },
            ]}
            value={kind}
            onChange={setKind}
          />
        }
      />
    </div>
  );
}

/** Saved ideas across topics. */
export function FavoritesTable({ favorites }: { favorites: Favorite[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const columns: Column<Favorite>[] = [
    { key: "text", header: "Idea", render: (f) => <span className="text-text">{f.text}</span> },
    { key: "kind", header: "Type", render: (f) => <Badge>{f.kind[0].toUpperCase() + f.kind.slice(1)}</Badge> },
    { key: "topic", header: "Topic", render: (f) => <Link href={`/topic-research?q=${encodeURIComponent(f.topic)}&db=${f.db}`} className="text-link hover:underline">{f.topic}</Link> },
    { key: "subtopic", header: "Subtopic" },
    { key: "db", header: "DB" },
    { key: "createdAt", header: "Saved", align: "right", render: (f) => <span className="text-[12px] whitespace-nowrap text-text-3">{dateLabel(f.createdAt)}</span>, csv: (f) => f.createdAt.slice(0, 10) },
    {
      key: "remove",
      header: "",
      sortable: false,
      noExport: true,
      width: "40px",
      render: (f) => (
        <button type="button" disabled={pending} onClick={() => start(async () => void (await removeFavoriteAction(f.id), router.refresh()))} className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-critical-ink" aria-label={`Remove ${f.text}`}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ),
    },
  ];
  return <DataTable rows={favorites} columns={columns} rowKey={(f) => f.id} defaultSort={{ key: "createdAt", dir: "desc" }} searchable searchPlaceholder="Filter saved ideas" searchText={(f) => `${f.text} ${f.topic} ${f.subtopic}`} exportName="topic-research_favorites" emptyText="No saved ideas yet. Click ★ next to a headline, question or subtopic to save it." />;
}
