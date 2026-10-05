"use client";

import { FilePlus2, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { draftFromBriefAction, generateBriefAction } from "@/app/(app)/optimizer/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { DATABASES } from "@/lib/domain";
import { timeAgo } from "@/lib/format";
import { FORMAT_LABEL, INTENT_LABEL } from "@/lib/optimizer/intent";
import type { BriefRow } from "@/lib/optimizer/store";
import type { Brief } from "@/lib/optimizer/types";
import { flashScore } from "../score-flash";

function BriefView({ id, brief, draftId }: { id: string; brief: Brief; draftId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="brand">{INTENT_LABEL[brief.intent]}</Badge>
        <Badge tone="neutral">{FORMAT_LABEL[brief.format]}</Badge>
        <Badge tone="neutral">{brief.funnel} stage</Badge>
        {brief.wordRange && (
          <Badge tone="neutral">
            {brief.wordRange[0].toLocaleString()}–{brief.wordRange[1].toLocaleString()} words
          </Badge>
        )}
        <Badge tone={brief.generatedBy === "ai" ? "info" : "neutral"}>{brief.generatedBy === "ai" ? "Written by Claude" : "From research"}</Badge>
      </div>
      <p className="text-[13px] text-text-2">{brief.audience}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-1 text-[12px] font-semibold tracking-wide text-text-3 uppercase">Outline</h3>
          <ul className="space-y-1">
            {brief.outline.map((o, i) => (
              <li key={i} className={o.level === 3 ? "ml-5 text-[12.5px]" : "text-[13px]"}>
                <span className="font-medium text-text">
                  {o.level === 2 ? "H2" : "H3"} · {o.text}
                </span>
                {o.notes && <span className="block text-[12px] text-text-3">{o.notes}</span>}
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-3 text-[13px]">
          <div>
            <h3 className="mb-1 text-[12px] font-semibold tracking-wide text-text-3 uppercase">Title ideas</h3>
            <ul className="list-disc space-y-0.5 pl-5 text-text">
              {brief.titleIdeas.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-[12px] font-semibold tracking-wide text-text-3 uppercase">Meta description</h3>
            <p className="text-text-2">{brief.metaDescription}</p>
          </div>
          {brief.questions.length > 0 && (
            <div>
              <h3 className="mb-1 text-[12px] font-semibold tracking-wide text-text-3 uppercase">Questions to answer</h3>
              <ul className="list-disc space-y-0.5 pl-5 text-text-2">
                {brief.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          )}
          {brief.entities.length > 0 && (
            <div>
              <h3 className="mb-1 text-[12px] font-semibold tracking-wide text-text-3 uppercase">Entities</h3>
              <div className="flex flex-wrap gap-1">
                {brief.entities.map((e) => (
                  <Badge key={e}>{e}</Badge>
                ))}
              </div>
            </div>
          )}
          {brief.coverage.length > 0 && (
            <div>
              <h3 className="mb-1 text-[12px] font-semibold tracking-wide text-text-3 uppercase">Concepts to cover</h3>
              <div className="flex flex-wrap gap-1">
                {brief.coverage.map((e) => (
                  <Badge key={e} tone="info">
                    {e}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <p className="text-[12px] text-text-3">Sources: {brief.sources.join(", ")}</p>
        </div>
      </div>
      {draftId ? (
        <Link href={`/optimizer?doc=${draftId}`} className="text-[13px] text-link hover:underline">
          Open the draft created from this brief →
        </Link>
      ) : (
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            const r = await draftFromBriefAction(id);
            setBusy(false);
            if (!r.ok) return flashScore({ title: "Draft not created", detail: r.error, error: true });
            router.push(`/optimizer?doc=${r.data.id}`);
          }}
        >
          {!busy && <FilePlus2 className="h-4 w-4" />} Create a draft from this brief
        </Button>
      )}
    </div>
  );
}

/** AI Content Brief Generator: keyword → intent, format, outline, entities, questions, coverage. */
export function BriefGenerator({ briefs, aiOn, serpOn, defaultKeyword }: { briefs: BriefRow[]; aiOn: boolean; serpOn: boolean; defaultKeyword?: string }) {
  const router = useRouter();
  const [f, setF] = useState({ keyword: defaultKeyword ?? "", db: "IN", competitors: "", audience: "", useAi: aiOn });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(briefs[0]?.id ?? null);
  const current = briefs.find((b) => b.id === open);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Generate a content brief" description={`${serpOn ? "Uses the live Google top 10 (DataForSEO)" : "Uses the competitor URLs you add"}, People Also Ask and Google Autocomplete${aiOn ? ", then Claude writes the brief" : ""}.`} />
        <CardBody className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_110px]">
            <Field label="Keyword or topic">
              <Input value={f.keyword} onChange={(e) => setF({ ...f, keyword: e.target.value })} placeholder="e.g. bba vs bcom which is better" />
            </Field>
            <Field label="Market">
              <Select value={f.db} onChange={(e) => setF({ ...f, db: e.target.value })}>
                {DATABASES.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Competitor URLs (optional)" hint="One per line">
              <Textarea rows={2} value={f.competitors} onChange={(e) => setF({ ...f, competitors: e.target.value })} />
            </Field>
            <Field label="Audience (optional)">
              <Input value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} placeholder="Class 12 students and parents in Gujarat" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-text" title={aiOn ? "" : "Add ANTHROPIC_API_KEY on the server"}>
            <Checkbox checked={f.useAi} disabled={!aiOn} onChange={(e) => setF({ ...f, useAi: e.target.checked })} />
            Write the brief with Claude {aiOn ? "" : "(not configured — the brief is built from research)"}
          </label>
          <Button
            variant="primary"
            loading={busy}
            disabled={!f.keyword.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const r = await generateBriefAction({ keyword: f.keyword, db: f.db, competitors: f.competitors.split(/\s+/).filter(Boolean), audience: f.audience || undefined, useAi: f.useAi && aiOn });
              setBusy(false);
              if (!r.ok) return setError(r.error);
              setOpen(r.data.id);
              router.refresh();
            }}
          >
            {!busy && (f.useAi && aiOn ? <Sparkles className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />)} Generate brief
          </Button>
          {error && <p className="text-[13px] text-critical-ink">{error}</p>}
        </CardBody>
      </Card>
      {current && (
        <Card>
          <CardHeader title={`Brief: ${current.keyword}`} description={`${current.db} · ${timeAgo(current.createdAt)}`} />
          <CardBody>
            <BriefView id={current.id} brief={current.brief} draftId={current.draftId} />
          </CardBody>
        </Card>
      )}
      {briefs.length > 1 && (
        <Card>
          <CardHeader title="Recent briefs" />
          <CardBody>
            <ul className="divide-y divide-border">
              {briefs.map((b) => (
                <li key={b.id}>
                  <button type="button" onClick={() => setOpen(b.id)} className="flex w-full items-center justify-between gap-2 py-2 text-left text-[13px] hover:text-link">
                    <span className="truncate">{b.keyword}</span>
                    <span className="shrink-0 text-[12px] text-text-3">
                      {b.brief.generatedBy === "ai" ? "Claude" : "research"} · {timeAgo(b.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
