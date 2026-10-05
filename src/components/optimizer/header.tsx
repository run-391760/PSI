"use client";

import { Bot, Check, ChevronDown, Copy, Download, FileText, Plus, Rocket, Search, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { aiReviewAction, createDraftAction, deleteDraftAction, duplicateDraftAction, publishAction, researchAction, unpublishAction } from "@/app/(app)/optimizer/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, Menu, MenuItem } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { DATABASES } from "@/lib/domain";
import { timeAgo } from "@/lib/format";
import type { DraftListItem } from "@/lib/optimizer/store";
import type { PublishStatus } from "@/lib/optimizer/types";
import { cn } from "@/lib/utils";
import { flashScore } from "./score-flash";
import { fmt10, PublishBadge, tone10 } from "./ui";

/** Draft picker: every draft with its score and status; links keep the current tab. */
export function DraftSwitcher({ drafts, currentId, basePath }: { drafts: DraftListItem[]; currentId: string; basePath: string }) {
  const cur = drafts.find((d) => d.id === currentId);
  return (
    <Menu
      trigger={(open) => (
        <button type="button" className="inline-flex max-w-[min(70vw,420px)] items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[13px] hover:bg-surface-3" aria-expanded={open}>
          <FileText className="h-3.5 w-3.5 shrink-0 text-text-3" />
          <span className="truncate">{cur?.title || cur?.keyword || "Untitled draft"}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-3" />
        </button>
      )}
      className="w-[min(92vw,420px)]"
    >
      <div className="scroll-thin max-h-80 overflow-y-auto py-1">
        {drafts.map((d) => (
          <Link key={d.id} href={`${basePath}?doc=${d.id}`} className={cn("flex items-center gap-2 px-3 py-1.5 hover:bg-surface-3", d.id === currentId && "bg-brand-soft")}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-text">{d.title || "Untitled draft"}</span>
              <span className="block truncate text-[11.5px] text-text-3">
                {d.keyword || "no keyword"} · {d.status === "published" ? "published" : "draft"} · {timeAgo(d.updatedAt)}
              </span>
            </span>
            <Badge tone={tone10(d.score)}>{fmt10(d.score)}</Badge>
            {d.id === currentId && <Check className="h-3.5 w-3.5 text-brand-ink" />}
          </Link>
        ))}
      </div>
    </Menu>
  );
}

/** New draft: paste/write, or import an existing page by URL (title, meta, canonical, robots, JSON-LD and body). */
export function NewDraftButton({ variant = "primary", label = "New draft" }: { variant?: "primary" | "secondary"; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"paste" | "url">("paste");
  const [form, setForm] = useState({ keyword: "", title: "", body: "", url: "", importUrl: "", db: "IN", competitors: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await createDraftAction({
      keyword: form.keyword,
      title: form.title || undefined,
      body: mode === "paste" ? form.body : undefined,
      url: form.url || undefined,
      importUrl: mode === "url" ? form.importUrl : undefined,
      db: form.db,
      competitors: form.competitors.split(/\s+/).filter(Boolean).slice(0, 10),
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.push(`/optimizer?doc=${r.data.id}`);
    router.refresh();
  };
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New draft to optimize"
        description="Paste your article (Markdown or plain text) or import an existing page. You can also start from a brief in Content Planning."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={submit}>
              Create and audit
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Segmented value={mode} onChange={setMode} options={[{ value: "paste", label: "Write / paste" }, { value: "url", label: "Import a URL" }]} />
          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <Field label="Primary keyword" hint="The query this article should rank for.">
              <Input value={form.keyword} onChange={set("keyword")} placeholder="e.g. mba admission process" autoFocus />
            </Field>
            <Field label="Market">
              <Select value={form.db} onChange={set("db")}>
                {DATABASES.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {mode === "paste" ? (
            <>
              <Field label="SEO title (optional)">
                <Input value={form.title} onChange={set("title")} placeholder="The <title> shown in search results" />
              </Field>
              <Field label="Article" hint="Markdown headings (# H1, ## H2), lists, links and images are understood.">
                <Textarea value={form.body} onChange={set("body")} rows={10} placeholder={"# Your H1\n\nIntroduction…\n\n## First section\n…"} />
              </Field>
              <Field label="Target URL (optional)">
                <Input value={form.url} onChange={set("url")} placeholder="https://example.com/blog/your-article" />
              </Field>
            </>
          ) : (
            <Field label="Page URL" hint="Fetched politely (robots.txt respected). Pages that need JavaScript to render can't be imported.">
              <Input value={form.importUrl} onChange={set("importUrl")} placeholder="https://example.com/blog/existing-article" />
            </Field>
          )}
          <Field label="Competitor URLs (optional)" hint="2–5 pages that rank for the keyword, separated by spaces or new lines. Used when live SERP data isn't configured.">
            <Textarea value={form.competitors} onChange={set("competitors")} rows={2} />
          </Field>
          {error && <p className="text-[13px] text-critical-ink">{error}</p>}
        </div>
      </Dialog>
    </>
  );
}

/** Header actions for the open draft: research, Claude review, export, publish, duplicate, delete. */
export function DraftActions({ draftId, status, published, aiOn, serpOn, hasCompetitors, blockers }: { draftId: string; status: PublishStatus; published: boolean; aiOn: boolean; serpOn: boolean; hasCompetitors: boolean; blockers: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: (r: never) => Parameters<typeof flashScore>[0]) => {
    setBusy(key);
    const r = (await fn()) as { ok: boolean; error?: string; data?: unknown };
    setBusy(null);
    if (r.ok) flashScore(ok(r.data as never));
    else flashScore({ title: "Something went wrong", detail: r.error, error: true });
    router.refresh();
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        loading={busy === "research"}
        disabled={!!busy}
        title={serpOn ? "Live Google results (DataForSEO), crawled competitor pages and Google Autocomplete" : hasCompetitors ? "Crawl your competitor URLs and fetch Google Autocomplete" : "Google Autocomplete only — add competitor URLs in the Search Intent tab for more"}
        onClick={() => run("research", () => researchAction(draftId), (d: { competitors: number; notes: string[] }) => ({ title: `Research done: ${d.competitors} pages analyzed`, detail: d.notes.join("\n") || undefined }))}
      >
        {!busy && <Search className="h-4 w-4" />} Run SERP research
      </Button>
      <Button
        loading={busy === "ai"}
        disabled={!!busy || !aiOn}
        title={aiOn ? "Claude scores intent, usefulness, originality, information gain and experience, and flags risky claims" : "Add ANTHROPIC_API_KEY on the server to enable Claude reviews"}
        onClick={() => run("ai", () => aiReviewAction(draftId), (d: { before: number | null; after: number | null; status: string }) => ({ title: "Claude review added", before: d.before, after: d.after, status: d.status }))}
      >
        {busy !== "ai" && <Bot className="h-4 w-4" />} Claude review
      </Button>
      {published ? (
        <Button variant="secondary" disabled={!!busy} onClick={() => run("unpub", () => unpublishAction(draftId), () => ({ title: "Moved back to draft" }))}>
          <Undo2 className="h-4 w-4" /> Unpublish
        </Button>
      ) : (
        <Button
          variant="primary"
          loading={busy === "publish"}
          disabled={!!busy || blockers > 0}
          title={blockers ? `Resolve ${blockers} publication blocker${blockers === 1 ? "" : "s"} first` : status === "ready" ? "Mark as published and stamp the dates" : "You can publish, but the article still needs improvement"}
          onClick={() => run("publish", () => publishAction(draftId), () => ({ title: "Published", detail: "Dates stamped. Export the HTML/Markdown package from the menu." }))}
        >
          {busy !== "publish" && <Rocket className="h-4 w-4" />} Publish
        </Button>
      )}
      <Menu
        align="right"
        trigger={() => (
          <Button variant="secondary" aria-label="More actions">
            <ChevronDown className="h-4 w-4" />
          </Button>
        )}
      >
        <MenuItem href={`/api/optimizer/${draftId}/export?format=html`} icon={<Download className="h-4 w-4 text-text-3" />}>
          Export HTML (meta + JSON-LD)
        </MenuItem>
        <MenuItem href={`/api/optimizer/${draftId}/export?format=md`} icon={<Download className="h-4 w-4 text-text-3" />}>
          Export Markdown
        </MenuItem>
        <MenuItem onClick={() => run("dup", () => duplicateDraftAction(draftId), () => ({ title: "Draft duplicated" }))} icon={<Copy className="h-4 w-4 text-text-3" />}>
          Duplicate
        </MenuItem>
        <MenuItem
          danger
          onClick={async () => {
            if (!confirm("Delete this draft and its history?")) return;
            const r = await deleteDraftAction(draftId);
            if (r.ok) {
              router.push("/optimizer");
              router.refresh();
            }
          }}
          icon={<Trash2 className="h-4 w-4" />}
        >
          Delete draft
        </MenuItem>
      </Menu>
    </div>
  );
}

export function StatusLine({ status, score }: { status: PublishStatus; score: number | null }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Badge tone={tone10(score)} className="text-[12.5px]">
        {fmt10(score)}/10
      </Badge>
      <PublishBadge status={status} />
    </span>
  );
}
