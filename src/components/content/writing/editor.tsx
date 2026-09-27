"use client";

import { ArrowLeft, Bold, Download, Globe, Heading1, Heading2, Heading3, Highlighter, Image as ImageIcon, Italic, Link2, List, ListOrdered, Quote } from "lucide-react";
import Link from "next/link";
import { type KeyboardEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { importUrlAction, recommendTargetsAction, saveDocumentAction } from "@/app/(app)/writing-assistant/actions";
import type { DocSettings } from "@/lib/content/documents";
import { htmlDocument, markdownToHtml } from "@/lib/content/markdown";
import { analyzeDocument, keywordRanges } from "@/lib/content/text";
import { downloadBlob } from "@/lib/csv";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DataSourceBadge } from "@/components/seo/source-badge";
import { PageHeader } from "@/components/shell/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, Menu, MenuItem } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { type HighlightRange, HighlightedTextarea } from "./highlighted-textarea";
import { ScorePanel } from "./score-panel";

type Doc = { id: string; title: string; body: string; keywords: string[]; settings: DocSettings; updated_at: string };
type SaveState = { status: "saved" | "dirty" | "saving" | "error"; at: string; error?: string };
type HlKey = "keyword" | "long" | "passive" | "repeat";

const HL: { key: HlKey; label: string; swatch: string }[] = [
  { key: "keyword", label: "Keywords", swatch: "bg-brand-soft shadow-[inset_0_-2px_0_var(--brand)]" },
  { key: "long", label: "Long sentences", swatch: "bg-warning-soft" },
  { key: "passive", label: "Passive voice", swatch: "bg-serious-soft" },
  { key: "repeat", label: "Repeats", swatch: "bg-critical-soft" },
];

export function WritingEditor({ doc, recommendSource = "autocomplete" }: { doc: Doc; recommendSource?: "serp" | "autocomplete" }) {
  const [title, setTitle] = useState(doc.title);
  const [body, setBody] = useState(doc.body);
  const [keywords, setKeywords] = useState(doc.keywords);
  const [settings, setSettings] = useState<DocSettings>(doc.settings);
  const [save, setSave] = useState<SaveState>({ status: "saved", at: doc.updated_at });
  const [hl, setHl] = useState<Record<HlKey, boolean>>({ keyword: true, long: true, passive: false, repeat: true });
  const [selected, setSelected] = useState<{ start: number; end: number } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [recommending, setRecommending] = useState(false);
  const [recommendError, setRecommendError] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const saved = useRef(JSON.stringify([doc.title, doc.body, doc.keywords, doc.settings]));
  const seq = useRef(0);

  const deferred = useDeferredValue(body);
  const deferredTitle = useDeferredValue(title);
  const analysis = useMemo(
    () => analyzeDocument(deferred, { keywords, recommended: settings.recommended, targetWords: settings.targetWords, targetReadability: settings.targetReadability, tone: settings.tone, title: deferredTitle }),
    [deferred, deferredTitle, keywords, settings],
  );

  // ------------------------------------------------------------------ autosave (debounced)
  const persist = useCallback(async () => {
    const id = ++seq.current;
    const snapshot = JSON.stringify([title, body, keywords, settings]);
    setSave((s) => ({ ...s, status: "saving" }));
    const res = await saveDocumentAction(doc.id, { title, body, keywords, settings, words: analysis.words, score: analysis.scores.overall });
    if (res.ok) saved.current = snapshot;
    if (id !== seq.current) return;
    setSave(res.ok ? { status: "saved", at: res.data.updatedAt } : { status: "error", at: new Date().toISOString(), error: res.error });
  }, [doc.id, title, body, keywords, settings, analysis.words, analysis.scores.overall]);
  const persistRef = useRef(persist);
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  useEffect(() => {
    if (JSON.stringify([title, body, keywords, settings]) === saved.current) return;
    setSave((s) => (s.status === "saving" ? s : { ...s, status: "dirty" }));
    const t = setTimeout(() => void persistRef.current(), 1200);
    return () => clearTimeout(t);
  }, [title, body, keywords, settings]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (save.status === "dirty" || save.status === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save.status]);

  // ------------------------------------------------------------------ highlights
  const ranges = useMemo(() => {
    const out: HighlightRange[] = [];
    if (hl.keyword) for (const k of keywords) for (const r of keywordRanges(deferred, k)) out.push({ ...r, kind: "keyword" });
    if (hl.long) for (const s of analysis.longSentences) out.push({ start: s.start, end: s.end, kind: "long" });
    if (hl.passive) for (const s of analysis.passive) out.push({ start: s.start, end: s.end, kind: "passive" });
    if (hl.repeat) for (const d of analysis.duplicates) for (const r of d.ranges) out.push({ ...r, kind: "repeat" });
    if (selected) out.push({ ...selected, kind: "selected" });
    // Ranges are computed on the deferred text; drop them while the user is mid-edit to avoid drift.
    return deferred === body ? out : [];
  }, [hl, keywords, deferred, body, analysis, selected]);

  const pick = (r: { start: number; end: number }) => {
    setSelected(r);
    const el = ta.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(r.start, r.end);
    requestAnimationFrame(() => document.getElementById("wa-selected")?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };
  useEffect(() => {
    if (!selected) return;
    const t = setTimeout(() => setSelected(null), 2500);
    return () => clearTimeout(t);
  }, [selected]);

  // ------------------------------------------------------------------ formatting
  const edit = (fn: (text: string, s: number, e: number) => { text: string; s: number; e: number }) => {
    const el = ta.current;
    if (!el) return;
    const res = fn(body, el.selectionStart, el.selectionEnd);
    setBody(res.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(res.s, res.e);
    });
  };
  const wrap = (before: string, after = before, placeholder = "text") =>
    edit((t, s, e) => {
      const inner = t.slice(s, e) || placeholder;
      return { text: t.slice(0, s) + before + inner + after + t.slice(e), s: s + before.length, e: s + before.length + inner.length };
    });
  const linePrefix = (prefix: string | ((i: number) => string), strip = /^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/) =>
    edit((t, s, e) => {
      const ls = t.lastIndexOf("\n", s - 1) + 1;
      let le = t.indexOf("\n", e);
      if (le === -1) le = t.length;
      const lines = t.slice(ls, le).split("\n");
      const out = lines.map((l, i) => (typeof prefix === "function" ? prefix(i) : prefix) + l.replace(strip, "")).join("\n");
      return { text: t.slice(0, ls) + out + t.slice(le), s: ls, e: ls + out.length };
    });
  const insertLink = () =>
    edit((t, s, e) => {
      const text = t.slice(s, e) || "link text";
      const ins = `[${text}](https://)`;
      const urlStart = s + text.length + 3;
      return { text: t.slice(0, s) + ins + t.slice(e), s: urlStart, e: urlStart + 8 };
    });
  const insertImage = () =>
    edit((t, s, e) => {
      const ins = `![describe the image](https://)`;
      return { text: t.slice(0, s) + ins + t.slice(e), s: s + 2, e: s + 20 };
    });
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === "b") (e.preventDefault(), wrap("**"));
    else if (e.key === "i") (e.preventDefault(), wrap("*"));
    else if (e.key === "k") (e.preventDefault(), insertLink());
    else if (e.key === "s") (e.preventDefault(), void persist());
  };

  // ------------------------------------------------------------------ export
  const fileBase = (title || "document").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60) || "document";
  const markdown = () => (/^\s*#\s/m.test(body) ? body : `# ${title}\n\n${body}`);
  const exportMd = () => downloadBlob(`${fileBase}.md`, new Blob([markdown()], { type: "text/markdown;charset=utf-8" }));
  const exportHtml = () => downloadBlob(`${fileBase}.html`, new Blob([htmlDocument(title, markdownToHtml(markdown()))], { type: "text/html;charset=utf-8" }));

  const recommend = async () => {
    setRecommending(true);
    setRecommendError(null);
    const res = await recommendTargetsAction(keywords, settings.db);
    setRecommending(false);
    if (res.ok) setSettings({ ...res.data, tone: settings.tone, origin: settings.origin });
    else setRecommendError(res.error);
  };

  const saveLabel =
    save.status === "saving" ? "Saving…" : save.status === "dirty" ? "Unsaved changes" : save.status === "error" ? `Not saved: ${save.error}` : `Saved ${timeAgo(save.at)}`;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Content marketing" }, { label: "SEO Writing Assistant", href: "/writing-assistant" }, { label: title || "Untitled document" }]}
        title="SEO Writing Assistant"
        meta={
          <>
            <DataSourceBadge source="user" note="scored in your browser" />
            {settings.targetsSource === "serp" && <DataSourceBadge source="dataforseo" note="targets from the crawled live top 10" />}
            {settings.targetsSource === "autocomplete" && <DataSourceBadge source="google-autocomplete" note="recommended words" />}
            <span className={cn("text-[12px]", save.status === "error" ? "text-critical-ink" : "text-text-3")} aria-live="polite">
              {saveLabel}
            </span>
          </>
        }
        actions={
          <>
            <Link href="/writing-assistant" className="inline-flex h-8.5 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-text-2 hover:bg-surface-3 hover:text-text">
              <ArrowLeft className="h-4 w-4" /> Documents
            </Link>
            <Button onClick={() => setImportOpen(true)}>
              <Globe className="h-4 w-4" /> Import from URL
            </Button>
            <Menu
              align="right"
              trigger={() => (
                <Button>
                  <Download className="h-4 w-4" /> Export
                </Button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem onClick={() => (exportMd(), close())}>Markdown (.md)</MenuItem>
                  <MenuItem onClick={() => (exportHtml(), close())}>HTML (.html)</MenuItem>
                </>
              )}
            </Menu>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0 overflow-hidden">
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-border bg-surface px-2 py-1.5">
            {[
              { icon: <Heading1 className="h-4 w-4" />, label: "Heading 1", run: () => linePrefix("# ") },
              { icon: <Heading2 className="h-4 w-4" />, label: "Heading 2", run: () => linePrefix("## ") },
              { icon: <Heading3 className="h-4 w-4" />, label: "Heading 3", run: () => linePrefix("### ") },
              { icon: <Bold className="h-4 w-4" />, label: "Bold (⌘B)", run: () => wrap("**") },
              { icon: <Italic className="h-4 w-4" />, label: "Italic (⌘I)", run: () => wrap("*") },
              { icon: <Link2 className="h-4 w-4" />, label: "Link (⌘K)", run: insertLink },
              { icon: <List className="h-4 w-4" />, label: "Bulleted list", run: () => linePrefix("- ") },
              { icon: <ListOrdered className="h-4 w-4" />, label: "Numbered list", run: () => linePrefix((i) => `${i + 1}. `) },
              { icon: <Quote className="h-4 w-4" />, label: "Quote", run: () => linePrefix("> ") },
              { icon: <ImageIcon className="h-4 w-4" />, label: "Image", run: insertImage },
            ].map((b) => (
              <button key={b.label} type="button" onMouseDown={(e) => e.preventDefault()} onClick={b.run} title={b.label} aria-label={b.label} className="flex h-8 w-8 items-center justify-center rounded text-text-2 hover:bg-surface-3 hover:text-text">
                {b.icon}
              </button>
            ))}
            <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
            <Menu
              align="left"
              trigger={() => (
                <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded px-2 text-[12.5px] text-text-2 hover:bg-surface-3 hover:text-text">
                  <Highlighter className="h-4 w-4" /> Highlights
                </button>
              )}
            >
              <div className="px-3 py-1.5">
                {HL.map((h) => (
                  <label key={h.key} className="flex cursor-pointer items-center gap-2 py-1 text-[13px]">
                    <input type="checkbox" className="accent-[var(--brand)]" checked={hl[h.key]} onChange={(e) => setHl((s) => ({ ...s, [h.key]: e.target.checked }))} />
                    <span className={cn("h-3 w-5 rounded-sm", h.swatch)} aria-hidden />
                    {h.label}
                  </label>
                ))}
              </div>
            </Menu>
            <span className="ml-auto pr-2 text-[12px] text-text-3 tabular">
              {analysis.words.toLocaleString("en-US")} words · score <b className="text-text">{analysis.scores.overall.toFixed(1)}</b>
            </span>
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 200))}
            placeholder="Title (used as the page title)"
            aria-label="Document title"
            className="w-full border-b border-border bg-transparent px-5 pt-4 pb-3 text-[18px] sm:text-[22px] font-semibold tracking-tight text-text placeholder:text-text-3 outline-none"
          />
          <HighlightedTextarea
            value={body}
            onChange={(v) => setBody(v.slice(0, 200_000))}
            ranges={ranges}
            textareaRef={ta}
            onKeyDown={onKeyDown}
            placeholder={"Start writing, paste your draft, or import a page from a URL.\n\nUse Markdown: # Heading, ## Subheading, **bold**, [link](https://…), - list item"}
          />
        </Card>

        <aside className="min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto scroll-thin">
          <ScorePanel
            a={analysis}
            settings={settings}
            keywords={keywords}
            onPick={pick}
            onKeywords={(k) => setKeywords([...new Set(k.map((x) => x.toLowerCase()))])}
            onSettings={setSettings}
            onRecommend={recommend}
            recommending={recommending}
            recommendError={recommendError}
            recommendSource={recommendSource}
          />
        </aside>
      </div>
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        hasText={!!body.trim()}
        onImport={(md, importedTitle, mode) => {
          setBody((b) => (mode === "append" && b.trim() ? `${b.trimEnd()}\n\n${md}` : md).slice(0, 200_000));
          if (!title.trim() || title === "Untitled document" || mode === "replace") setTitle(importedTitle.slice(0, 200));
        }}
      />
    </>
  );
}

function ImportDialog({ open, onClose, onImport, hasText }: { open: boolean; onClose: () => void; onImport: (md: string, title: string, mode: "replace" | "append") => void; hasText: boolean }) {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async () => {
    setPending(true);
    setError(null);
    const res = await importUrlAction(url);
    setPending(false);
    if (!res.ok) return setError(res.error);
    onImport(res.data.markdown, res.data.title, mode);
    setUrl("");
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Import text from a URL"
      description="We fetch the page (respecting robots.txt), extract the main content and convert it to Markdown."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={submit} disabled={!url.trim()}>
            Import
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-3"
      >
        {error && <Callout tone="critical">{error}</Callout>}
        <Field label="Page URL" htmlFor="wa-import-url">
          <Input id="wa-import-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/blog/article" autoFocus />
        </Field>
        {hasText && (
          <Field label="Existing text">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: "replace", label: "Replace" },
                { value: "append", label: "Append" },
              ]}
            />
          </Field>
        )}
      </form>
    </Dialog>
  );
}
