"use client";

import { AlertTriangle, CheckCircle2, Info, OctagonAlert, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Check, DocAnalysis } from "@/lib/content/text";
import { fleschLabel } from "@/lib/content/text";
import type { DocSettings } from "@/lib/content/documents";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Bar, ScoreRing } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/tabs";

const ICON: Record<Check["status"], ReactNode> = {
  good: <CheckCircle2 className="h-4 w-4 text-good-ink" />,
  warning: <AlertTriangle className="h-4 w-4 text-warning-ink" />,
  critical: <OctagonAlert className="h-4 w-4 text-critical-ink" />,
  info: <Info className="h-4 w-4 text-text-3" />,
};

function scoreColor(v: number) {
  return v >= 8 ? "var(--good)" : v >= 6 ? "var(--warning)" : v >= 4 ? "var(--serious)" : "var(--critical)";
}
function verdict(v: number, words: number) {
  if (!words) return "Start writing";
  return v >= 8.5 ? "Excellent" : v >= 7 ? "Good" : v >= 5 ? "Needs work" : "Poor";
}

function Checks({ list }: { list: Check[] }) {
  return (
    <ul className="space-y-2">
      {list.map((c) => (
        <li key={c.id} className="flex gap-2 text-[13px]">
          <span className="mt-px shrink-0">{ICON[c.status]}</span>
          <div className="min-w-0">
            <div className="text-text">{c.label}</div>
            {c.detail && <div className="text-[12px] text-text-3">{c.detail}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function SentenceList({ items, onPick, empty, tone }: { items: { start: number; end: number; text: string; meta?: string }[]; onPick: (s: { start: number; end: number }) => void; empty: string; tone: string }) {
  if (!items.length) return <p className="text-[12.5px] text-text-3">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((s, i) => (
        <li key={`${s.start}-${i}`}>
          <button type="button" onClick={() => onPick(s)} className={cn("w-full rounded-md border-l-[3px] bg-surface-2 px-2.5 py-1.5 text-left text-[12.5px] text-text-2 hover:bg-surface-3", tone)}>
            <span className="line-clamp-2">{s.text}</span>
            {s.meta && <span className="mt-0.5 block text-[11px] text-text-3">{s.meta}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Heading({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-4 mb-2 flex items-center justify-between gap-2 border-t border-border pt-3 first:mt-0 first:border-t-0 first:pt-0">
      <h3 className="text-[12.5px] font-semibold tracking-wide text-text-2 uppercase">{children}</h3>
      {right}
    </div>
  );
}

type Tab = "seo" | "readability" | "originality" | "tone" | "targets";

export function ScorePanel({
  a,
  settings,
  keywords,
  onPick,
  onKeywords,
  onSettings,
  onRecommend,
  recommending,
  recommendError,
}: {
  a: DocAnalysis;
  settings: DocSettings;
  keywords: string[];
  onPick: (r: { start: number; end: number }) => void;
  onKeywords: (k: string[]) => void;
  onSettings: (s: DocSettings) => void;
  onRecommend: () => void;
  recommending: boolean;
  recommendError: string | null;
}) {
  const [tab, setTab] = useState<Tab>("seo");
  const kwJoined = keywords.join(", ");
  const recJoined = settings.recommended.join(", ");
  const [kwDraft, setKwDraft] = useState(kwJoined);
  const [recDraft, setRecDraft] = useState(recJoined);
  const [synced, setSynced] = useState({ kw: kwJoined, rec: recJoined });
  if (synced.kw !== kwJoined || synced.rec !== recJoined) {
    // Props changed from outside (e.g. "Get recommendations"): refresh the drafts.
    setSynced({ kw: kwJoined, rec: recJoined });
    setKwDraft(kwJoined);
    setRecDraft(recJoined);
  }
  const s = a.scores;
  const target = settings.targetWords;
  const fl = fleschLabel(a.flesch);
  const toneTarget = settings.tone === "casual" ? -0.4 : settings.tone === "formal" ? 0.4 : 0;
  const pos = (v: number) => `${((Math.max(-1, Math.min(1, v)) + 1) / 2) * 100}%`;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-4 border-b border-border px-4 py-4">
        <ScoreRing value={s.overall * 10} size={84} stroke={8} label={s.overall.toFixed(1)} color={scoreColor(s.overall)} sub="of 10" />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] text-text-2">Overall score</div>
          <div className="text-[18px] font-semibold text-text">{verdict(s.overall, a.words)}</div>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
            {(
              [
                ["SEO", s.seo, "seo"],
                ["Readability", s.readability, "readability"],
                ["Originality", s.originality, "originality"],
                ["Tone of voice", s.tone, "tone"],
              ] as [string, number, Tab][]
            ).map(([label, v, id]) => (
              <button key={label} type="button" onClick={() => setTab(id)} className="text-left">
                <div className="flex items-baseline justify-between text-[11.5px]">
                  <span className={cn("text-text-3", tab === id && "font-medium text-text")}>{label}</span>
                  <span className="tabular font-medium text-text">{v.toFixed(1)}</span>
                </div>
                <Bar value={v * 10} color={scoreColor(v)} className="mt-0.5 h-1" />
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="border-b border-border px-4 py-3">
        <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
          <span className="text-text-2">Words</span>
          <span className="tabular">
            <span className="font-semibold text-text">{a.words.toLocaleString("en-US")}</span>
            {target > 0 && <span className="text-text-3"> / {target.toLocaleString("en-US")} target</span>}
          </span>
        </div>
        <Bar value={target ? Math.min(100, (a.words / target) * 100) : 0} color={target && a.words >= target * 0.9 ? "var(--good)" : "var(--series-1)"} />
        <div className="mt-1.5 flex justify-between text-[11.5px] text-text-3">
          <span>{a.readingTimeMin} min read</span>
          <span>
            {a.sentences} sentences · {a.paragraphs} paragraphs
          </span>
        </div>
      </div>
      <div className="scroll-thin overflow-x-auto border-b border-border px-3 py-2">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "seo", label: "SEO" },
            { value: "readability", label: "Readability" },
            { value: "originality", label: "Originality" },
            { value: "tone", label: "Tone" },
            { value: "targets", label: "Targets" },
          ]}
        />
      </div>
      <div className="px-4 py-4">
        {tab === "seo" && (
          <>
            <Checks list={a.checks.seo} />
            <Heading>Target keywords</Heading>
            {a.keywords.length ? (
              <ul className="space-y-1.5">
                {a.keywords.map((k) => (
                  <li key={k.keyword} className="flex items-center gap-2 text-[13px]">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", k.count === 0 ? "bg-critical" : k.density > 3 ? "bg-warning" : "bg-good")} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-text">{k.keyword}</span>
                    <span className="tabular text-text-2">{k.count}×</span>
                    <span className="tabular w-12 text-right text-text-3">{k.density}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <button type="button" className="text-[12.5px] text-link hover:underline" onClick={() => setTab("targets")}>
                Add target keywords →
              </button>
            )}
            <Heading right={settings.demoTargets ? <Badge tone="warning">Demo data</Badge> : undefined}>Recommended keywords</Heading>
            {a.recommended.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {a.recommended.map((r) => (
                  <li key={r.keyword} className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[12.5px]", r.used ? "border-good/40 bg-good-soft text-good-ink" : "border-border bg-surface-2 text-text-2")}>
                    {r.used && <CheckCircle2 className="h-3 w-3" />}
                    {r.keyword}
                    {r.count > 0 && <span className="text-[11px] opacity-70">{r.count}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-text-3">No recommended keywords. Get them from the top 10 on the Targets tab.</p>
            )}
          </>
        )}

        {tab === "readability" && (
          <>
            <div className="mb-3 flex items-end gap-4">
              <div>
                <div className="text-[12px] text-text-3">Flesch reading ease</div>
                <div className="text-[28px] leading-none font-semibold text-text">{a.flesch != null ? Math.round(a.flesch) : "n/a"}</div>
              </div>
              <div className="pb-0.5 text-[12.5px] text-text-2">
                {fl.label}
                {fl.audience && <span className="text-text-3"> · {fl.audience}</span>}
                <div className="text-text-3">Target {settings.targetReadability} · grade {a.grade ?? "n/a"}</div>
              </div>
            </div>
            <div className="relative mb-4 h-2 rounded-full bg-[linear-gradient(90deg,var(--critical),var(--serious),var(--warning),var(--good))]">
              <span className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 bg-text-3" style={{ left: `${settings.targetReadability}%` }} title="Target" aria-hidden />
              {a.flesch != null && <span className="absolute -top-1.5 h-5 w-1.5 -translate-x-1/2 rounded bg-text" style={{ left: `${Math.max(0, Math.min(100, a.flesch))}%` }} aria-hidden />}
            </div>
            <Checks list={a.checks.readability} />
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                ["Avg. sentence", `${a.avgSentenceLength} words`],
                ["Passive", `${a.passive.length}`],
                ["Complex words", `${a.complexShare}%`],
              ].map(([l, v]) => (
                <div key={l} className="rounded-md bg-surface-2 px-2 py-1.5">
                  <div className="text-[11px] text-text-3">{l}</div>
                  <div className="text-[13px] font-semibold text-text">{v}</div>
                </div>
              ))}
            </div>
            <Heading right={<span className="text-[11.5px] text-text-3">click to select</span>}>Long sentences</Heading>
            <SentenceList items={a.longSentences.map((x) => ({ ...x, meta: `${x.words} words` }))} onPick={onPick} empty="No sentences over 25 words." tone="border-warning" />
            <Heading>Passive voice</Heading>
            <SentenceList items={a.passive} onPick={onPick} empty="No passive sentences detected." tone="border-serious" />
            {a.longParagraphs.length > 0 && (
              <>
                <Heading>Long paragraphs</Heading>
                <SentenceList items={a.longParagraphs.map((p) => ({ start: p.start, end: p.end, text: p.preview + "…", meta: `${p.words} words` }))} onPick={onPick} empty="" tone="border-warning" />
              </>
            )}
            {a.complexWords.length > 0 && (
              <>
                <Heading>Complex words</Heading>
                <ul className="flex flex-wrap gap-1.5">
                  {a.complexWords.map((w) => (
                    <li key={w.word} className="rounded-md bg-surface-2 px-2 py-0.5 text-[12.5px] text-text-2">
                      {w.word}
                      {w.count > 1 && <span className="ml-1 text-[11px] text-text-3">×{w.count}</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {tab === "originality" && (
          <>
            <Callout tone="info" className="mb-3">
              This checks for repeated sentences and phrases <b>within this document only</b>. It is not a plagiarism check against other websites.
            </Callout>
            <div className="mb-3 flex items-center gap-3">
              <ScoreRing value={a.originality} size={56} stroke={6} color={a.originality >= 95 ? "var(--good)" : a.originality >= 85 ? "var(--warning)" : "var(--critical)"} />
              <div className="text-[13px] text-text-2">of your text is not repeated elsewhere in the document.</div>
            </div>
            <Checks list={a.checks.originality} />
            <Heading>Repeated sentences</Heading>
            <SentenceList items={a.duplicates.map((d) => ({ ...d.ranges[0], text: d.text, meta: `Appears ${d.count}×` }))} onPick={onPick} empty="No repeated sentences." tone="border-critical" />
            <Heading>Repeated phrases</Heading>
            {a.repeatedPhrases.length ? (
              <ul className="space-y-1">
                {a.repeatedPhrases.map((p) => (
                  <li key={p.phrase} className="flex justify-between gap-2 text-[12.5px]">
                    <span className="text-text-2">“{p.phrase}…”</span>
                    <span className="tabular shrink-0 text-text-3">{p.count}×</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-text-3">No repeated 6-word phrases.</p>
            )}
          </>
        )}

        {tab === "tone" && (
          <>
            <div className="mb-1 flex justify-between text-[11.5px] text-text-3">
              <span>Casual</span>
              <span>Neutral</span>
              <span>Formal</span>
            </div>
            <div className="relative mb-2 h-2 rounded-full bg-surface-3">
              <span className="absolute top-0 h-2 w-[30%] -translate-x-1/2 rounded-full bg-good/25" style={{ left: pos(toneTarget) }} title="Target zone" aria-hidden />
              <span className="absolute -top-1.5 h-5 w-1.5 -translate-x-1/2 rounded bg-text" style={{ left: pos(a.tone.score) }} aria-hidden />
            </div>
            <p className="mb-3 text-[13px] text-text-2">
              Your text reads as <b className="text-text">{a.tone.label.toLowerCase()}</b>. Target: {settings.tone}. The shaded zone is the target range.
            </p>
            <Checks list={a.checks.tone} />
            <Heading>Most casual sentences</Heading>
            <SentenceList items={a.tone.casual} onPick={onPick} empty="None stand out as too casual." tone="border-series-2" />
            <Heading>Most formal sentences</Heading>
            <SentenceList items={a.tone.formal} onPick={onPick} empty="None stand out as too formal." tone="border-series-7" />
            <p className="mt-3 text-[11.5px] text-text-3">Heuristic: contractions, exclamations, slang and direct address read as casual; long words, passive voice and bureaucratic terms read as formal.</p>
          </>
        )}

        {tab === "targets" && (
          <div className="space-y-3">
            <Field label="Target keywords" hint="Comma separated. The first one is the main keyword." htmlFor="wa-kw">
              <Input id="wa-kw" value={kwDraft} onChange={(e) => setKwDraft(e.target.value)} onBlur={() => onKeywords(kwDraft.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 10))} placeholder="e.g. running shoes, trail running" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Target words" htmlFor="wa-words">
                <Input id="wa-words" type="number" min={0} max={20000} value={settings.targetWords} onChange={(e) => onSettings({ ...settings, targetWords: Math.max(0, Math.min(20000, Number(e.target.value) || 0)) })} />
              </Field>
              <Field label="Readability (Flesch)" htmlFor="wa-read">
                <Input id="wa-read" type="number" min={0} max={100} value={settings.targetReadability} onChange={(e) => onSettings({ ...settings, targetReadability: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
              </Field>
            </div>
            <Field label="Tone of voice">
              <Segmented
                value={settings.tone}
                onChange={(tone) => onSettings({ ...settings, tone })}
                options={[
                  { value: "casual", label: "Casual" },
                  { value: "neutral", label: "Neutral" },
                  { value: "formal", label: "Formal" },
                ]}
              />
            </Field>
            <Field label="Recommended keywords" hint="Comma separated related words to cover." htmlFor="wa-rec">
              <Textarea id="wa-rec" rows={3} value={recDraft} onChange={(e) => setRecDraft(e.target.value)} onBlur={() => onSettings({ ...settings, recommended: recDraft.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 40), demoTargets: false })} className="min-h-0" />
            </Field>
            <div className="rounded-md border border-border bg-surface-2 p-3">
              <div className="flex items-center gap-2 text-[13px] font-medium text-text">
                <Sparkles className="h-4 w-4 text-brand" /> Targets from the top 10
              </div>
              <p className="mt-1 text-[12px] text-text-3">Sets word count, readability and recommended keywords from the top-10 benchmark for your main keyword (demo data).</p>
              {recommendError && <p className="mt-1 text-[12px] text-critical-ink">{recommendError}</p>}
              <Button
                size="sm"
                className="mt-2"
                loading={recommending}
                disabled={!keywords.length}
                onClick={() => {
                  onRecommend();
                }}
              >
                Get recommendations
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
