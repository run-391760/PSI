"use client";

import { useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { saveDraftAction } from "@/app/(app)/optimizer/actions";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { timeAgo } from "@/lib/format";
import { analyze } from "@/lib/optimizer/analyze";
import type { OtherDraft } from "@/lib/optimizer/context";
import { aiFresh } from "@/lib/optimizer/hash";
import type { Draft, DraftInput, ResearchBundle } from "@/lib/optimizer/types";
import { cn } from "@/lib/utils";
import type { VerifiedScore } from "@/lib/optimizer/agents/types";
import { ScoreCard } from "./score-card";

type Save = { status: "saved" | "dirty" | "saving" | "error"; at: string; error?: string };

const counter = (n: number, lo: number, hi: number) => (n === 0 ? "text-text-3" : n >= lo && n <= hi ? "text-good-ink" : "text-warning-ink");

/**
 * Write / paste step: the draft's search-facing fields and Markdown body, autosaved, with the full
 * audit re-run in the browser on every change so the score updates while you write.
 */
export function DraftEditor({ draft, bundle, others, verified }: { draft: Draft; bundle: ResearchBundle; others: OtherDraft[]; verified?: VerifiedScore | null }) {
  const router = useRouter();
  const [f, setF] = useState({ title: draft.title, keyword: draft.keyword, keywords: draft.keywords.join(", "), metaDescription: draft.metaDescription, slug: draft.slug, url: draft.url, body: draft.body });
  const [save, setSave] = useState<Save>({ status: "saved", at: draft.updatedAt });
  const saved = useRef(JSON.stringify(f));
  const initial = useRef(saved.current);
  const seq = useRef(0);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const input = useMemo<DraftInput>(() => ({ ...f, keywords: f.keywords.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 10), meta: draft.meta }), [f, draft.meta]);
  const deferred = useDeferredValue(input);
  const report = useMemo(() => analyze(deferred, { research: bundle.research, ai: aiFresh(bundle.ai, deferred.body) ? bundle.ai : null, links: bundle.links, live: bundle.live, others }), [deferred, bundle, others]);

  const persist = useCallback(async () => {
    const id = ++seq.current;
    const snapshot = JSON.stringify(f);
    setSave((s) => ({ ...s, status: "saving" }));
    const r = await saveDraftAction(draft.id, { title: f.title, keyword: f.keyword, keywords: input.keywords, metaDescription: f.metaDescription, slug: f.slug, url: f.url, body: f.body });
    if (r.ok) saved.current = snapshot;
    if (id !== seq.current) return;
    setSave(r.ok ? { status: "saved", at: r.data.updatedAt } : { status: "error", at: new Date().toISOString(), error: r.error });
    if (r.ok) router.refresh();
  }, [draft.id, f, input.keywords, router]);
  const persistRef = useRef(persist);
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);
  useEffect(() => {
    if (JSON.stringify(f) === saved.current) return;
    setSave((s) => (s.status === "saving" ? s : { ...s, status: "dirty" }));
    const t = setTimeout(() => void persistRef.current(), 1500);
    return () => clearTimeout(t);
  }, [f]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (JSON.stringify(f) !== saved.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [f]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="min-w-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 className="text-[14px] font-semibold text-text">Draft</h2>
          <span className={cn("text-[12px]", save.status === "error" ? "text-critical-ink" : "text-text-3")} role="status">
            {save.status === "saving" ? "Saving…" : save.status === "dirty" ? "Unsaved changes" : save.status === "error" ? `Not saved: ${save.error}` : `Saved ${timeAgo(save.at)}`}
          </span>
        </div>
        <div className="space-y-3 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Primary keyword">
              <Input value={f.keyword} onChange={set("keyword")} placeholder="e.g. mba admission process" />
            </Field>
            <Field label="Secondary keywords" hint="Comma-separated, optional">
              <Input value={f.keywords} onChange={set("keywords")} />
            </Field>
          </div>
          <Field label={<span className="flex w-full justify-between">SEO title <span className={counter(f.title.length, 30, 60)}>{f.title.length}/60</span></span>}>
            <Input value={f.title} onChange={set("title")} placeholder="Title shown in search results" />
          </Field>
          <Field label={<span className="flex w-full justify-between">Meta description <span className={counter(f.metaDescription.length, 120, 160)}>{f.metaDescription.length}/160</span></span>}>
            <Textarea value={f.metaDescription} onChange={set("metaDescription")} rows={2} />
          </Field>
          <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
            <Field label="URL slug">
              <Input value={f.slug} onChange={set("slug")} placeholder="mba-admission-process" />
            </Field>
            <Field label="Target URL">
              <Input value={f.url} onChange={set("url")} placeholder="https://example.com/blog/…" />
            </Field>
          </div>
          <Field label={<span className="flex w-full justify-between">Article (Markdown) <span className="text-text-3">{report.words.toLocaleString()} words</span></span>} hint="# H1, ## sections, ### sub-points, - lists, | tables |, [links](url), ![alt](image.jpg). [Write: …] placeholders block publishing.">
            <Textarea value={f.body} onChange={set("body")} rows={26} spellCheck className="font-mono text-[13px] leading-relaxed" placeholder={"# Your H1\n\nIntroduction…\n\n## First section\n\n…"} />
          </Field>
        </div>
      </Card>
      <div className="min-w-0 xl:sticky xl:top-28 xl:self-start">
        {/* The agent-verified score describes the saved draft: show it until the first edit, then the live engine score. */}
        <ScoreCard report={report} draftId={draft.id} baseline={draft.baselineScore} compact verified={JSON.stringify(f) === initial.current ? verified : null} />
        <p className="mt-2 px-1 text-[11.5px] text-text-3">Scores update as you type{bundle.research ? "" : "; run SERP research to score topical coverage"}.</p>
      </div>
    </div>
  );
}
