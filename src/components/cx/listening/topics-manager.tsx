"use client";

import { Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteTopicAction, saveTopicAction, toggleTopicAction } from "@/app/(app)/cx/listening/actions";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { compact, timeAgo } from "@/lib/format";
import { LISTEN_SOURCES, SOURCE_LABELS, TOPIC_KINDS, languageName, type ListenSource, type TopicKind } from "@/lib/cx/listening/sources";
import { SourceIcon } from "./source-icon";

export type TopicView = {
  id: string;
  name: string;
  kind: TopicKind;
  keywords: string[];
  excluded: string[];
  sources: ListenSource[];
  languages: string[];
  app_ids: string[];
  active: boolean;
  mentions: number;
  last_mention: string | null;
};

export const KIND_TONE: Record<string, Tone> = { brand: "brand", competitor: "serious", campaign: "info", industry: "neutral" };
const KIND_LABEL: Record<TopicKind, string> = { brand: "Brand", competitor: "Competitor", campaign: "Campaign", industry: "Industry" };
const splitList = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

export function TopicsManager({ brandId, topics, available, defaults }: { brandId: string; topics: TopicView[]; available: Record<string, boolean>; defaults: { name: string; keyword: string } }) {
  const router = useRouter();
  const [editing, setEditing] = useState<TopicView | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) setError(r.error ?? "Failed.");
    else router.refresh();
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] text-text-2">
          {topics.length} {topics.length === 1 ? "topic" : "topics"} · keywords are matched as whole words; one rule per line, <code className="rounded bg-surface-3 px-1">AND</code> /{" "}
          <code className="rounded bg-surface-3 px-1">OR</code> supported.
        </div>
        <Button variant="primary" onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" /> Add topic
        </Button>
      </div>
      {error && <Callout tone="critical" className="mb-3">{error}</Callout>}
      <div className="grid gap-3">
        {topics.map((t) => (
          <div key={t.id} className={`rounded-lg border border-border bg-surface p-4 shadow-card ${t.active ? "" : "opacity-70"}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-semibold text-text">{t.name}</span>
                  <Badge tone={KIND_TONE[t.kind]}>{KIND_LABEL[t.kind]}</Badge>
                  {!t.active && <Badge>Paused</Badge>}
                </div>
                <div className="mt-0.5 text-[12.5px] text-text-3">
                  {compact(t.mentions)} mentions{t.last_mention ? ` · latest ${timeAgo(t.last_mention)}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(t)} aria-label={`Edit ${t.name}`}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button size="sm" variant="ghost" loading={busy === `t:${t.id}`} onClick={() => run(`t:${t.id}`, () => toggleTopicAction(brandId, t.id, !t.active))}>
                  {t.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {t.active ? "Pause" : "Resume"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete ${t.name}`}
                  loading={busy === `d:${t.id}`}
                  onClick={() => confirm(`Delete topic "${t.name}"? Its mentions stay but lose their topic.`) && run(`d:${t.id}`, () => deleteTopicAction(brandId, t.id))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <dl className="mt-3 grid gap-2 text-[12.5px] sm:grid-cols-[110px_1fr]">
              <dt className="text-text-3">Keywords</dt>
              <dd className="flex flex-wrap gap-1">
                {t.keywords.map((k) => (
                  <span key={k} className="rounded bg-brand-soft px-1.5 py-0.5 text-text">{k}</span>
                ))}
              </dd>
              {t.excluded.length > 0 && (
                <>
                  <dt className="text-text-3">Excluded</dt>
                  <dd className="flex flex-wrap gap-1">
                    {t.excluded.map((k) => (
                      <span key={k} className="rounded bg-surface-3 px-1.5 py-0.5 text-text-2 line-through">{k}</span>
                    ))}
                  </dd>
                </>
              )}
              <dt className="text-text-3">Sources</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                {t.sources.length ? t.sources.map((s) => <SourceIcon key={s} source={s} />) : <span className="text-text-2">All sources</span>}
              </dd>
              <dt className="text-text-3">Languages</dt>
              <dd className="text-text-2">{t.languages.length ? t.languages.map(languageName).join(", ") : "Any"}</dd>
              {t.app_ids.length > 0 && (
                <>
                  <dt className="text-text-3">App Store ids</dt>
                  <dd className="text-text-2 tabular-nums">{t.app_ids.join(", ")}</dd>
                </>
              )}
            </dl>
          </div>
        ))}
      </div>
      {editing && (
        <TopicDialog
          brandId={brandId}
          topic={editing === "new" ? null : editing}
          available={available}
          defaults={topics.length ? { name: "", keyword: "" } : defaults}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function TopicDialog({ brandId, topic, available, defaults, onClose, onSaved }: { brandId: string; topic: TopicView | null; available: Record<string, boolean>; defaults: { name: string; keyword: string }; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(topic?.name ?? defaults.name);
  const [kind, setKind] = useState<TopicKind>(topic?.kind ?? "brand");
  const [keywords, setKeywords] = useState((topic?.keywords ?? (defaults.keyword ? [defaults.keyword] : [])).join("\n"));
  const [excluded, setExcluded] = useState((topic?.excluded ?? []).join(", "));
  const [sources, setSources] = useState<ListenSource[]>(topic?.sources ?? []);
  const [languages, setLanguages] = useState((topic?.languages ?? []).join(", "));
  const [appIds, setAppIds] = useState((topic?.app_ids ?? []).join(", "));
  const [active, setActive] = useState(topic?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const r = await saveTopicAction(
      brandId,
      { name, kind, keywords: keywords.split("\n").map((k) => k.trim()).filter(Boolean), excluded: splitList(excluded), sources, languages: splitList(languages), appIds: splitList(appIds), active },
      topic?.id,
    );
    setSaving(false);
    if (r.ok) onSaved();
    else setError(r.error);
  };
  const toggle = (s: ListenSource) => setSources((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={topic ? `Edit topic: ${topic.name}` : "Add topic"}
      description="Mentions are fetched hourly from the selected sources and matched against these keywords."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving}>{topic ? "Save topic" : "Add topic and fetch"}</Button>
        </>
      }
    >
      <div className="grid gap-3.5">
        {error && <Callout tone="critical">{error}</Callout>}
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <Field label="Name" htmlFor="t-name">
            <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme" maxLength={80} />
          </Field>
          <Field label="Type" htmlFor="t-kind">
            <Select id="t-kind" value={kind} onChange={(e) => setKind(e.target.value as TopicKind)}>
              {TOPIC_KINDS.map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Keywords" htmlFor="t-kw" hint={'One rule per line. Phrases are matched exactly. Example: acme AND (refund OR "late delivery")'}>
          <Textarea id="t-kw" rows={4} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={"acme\nacme app\n@acmehq"} />
        </Field>
        <Field label="Excluded words" htmlFor="t-ex" hint="Comma separated. A mention containing any of them is skipped.">
          <Input id="t-ex" value={excluded} onChange={(e) => setExcluded(e.target.value)} placeholder="acme corp hiring, wile e coyote" />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-[12.5px] font-medium text-text">Sources <span className="font-normal text-text-3">(none selected = all)</span></legend>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {LISTEN_SOURCES.map((s) => (
              <label key={s} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-[12.5px]">
                <Checkbox checked={sources.includes(s)} onChange={() => toggle(s)} />
                <span className="min-w-0 truncate">{SOURCE_LABELS[s]}</span>
                {!available[s] && <span className="ml-auto text-[11px] text-text-3" title="Not configured on this server">key</span>}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Languages" htmlFor="t-lang" hint="ISO codes, e.g. en, hi. Empty = any.">
            <Input id="t-lang" value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder="en, hi" />
          </Field>
          <Field label="App Store app ids" htmlFor="t-app" hint="e.g. 284882215 or gb/284882215">
            <Input id="t-app" value={appIds} onChange={(e) => setAppIds(e.target.value)} placeholder="284882215" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (fetched on schedule)
        </label>
      </div>
    </Dialog>
  );
}
