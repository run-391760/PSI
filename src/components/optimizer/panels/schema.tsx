"use client";

import { Check, Copy, Save, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { updateSettingsAction } from "@/app/(app)/optimizer/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { detectFormat } from "@/lib/optimizer/intent";
import { parseDraft } from "@/lib/optimizer/parse";
import { generateSchema, recommendSchema, validateSchema } from "@/lib/optimizer/schema";
import type { Draft } from "@/lib/optimizer/types";
import { flashScore } from "../score-flash";

/** Schema module: recommendations, generator and a JSON-LD editor validated as you type. */
export function SchemaPanel({ draft }: { draft: Draft }) {
  const router = useRouter();
  const doc = useMemo(() => parseDraft(draft.body), [draft.body]);
  const format = useMemo(() => detectFormat(draft.title, doc).format, [draft.title, doc]);
  const recs = useMemo(() => recommendSchema(draft, doc, format), [draft, doc, format]);
  const generated = useMemo(() => JSON.stringify(generateSchema(draft, doc, format), null, 2), [draft, doc, format]);
  const [text, setText] = useState(draft.meta.schema ?? "");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const v = useMemo(() => validateSchema(text, draft, doc), [text, draft, doc]);
  const save = async (value: string, note: string) => {
    setBusy(true);
    const r = await updateSettingsAction(draft.id, { meta: { schema: value } }, note);
    setBusy(false);
    if (r.ok) flashScore({ title: note, before: r.data.before, after: r.data.after, status: r.data.status });
    else flashScore({ title: "Not saved", detail: r.error, error: true });
    router.refresh();
  };
  const tag = `<script type="application/ld+json">\n${text.trim()}\n</script>`;
  return (
    <Card>
      <CardHeader
        title="JSON-LD structured data"
        description="Generated only from what is visible in the article and its settings. Edit freely; validation runs as you type."
        actions={
          <div className="flex flex-wrap gap-1.5">
            {recs.map((r) => (
              <Badge key={r.type} tone={v.types.includes(r.type) ? "good" : r.essential ? "critical" : "neutral"} title={r.reason}>
                {r.type}
              </Badge>
            ))}
          </div>
        }
      />
      <CardBody className="space-y-3">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={18} spellCheck={false} className="font-mono text-[12.5px]" placeholder="No JSON-LD yet — use the generated version below or paste your own." />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            loading={busy}
            onClick={() => {
              setText(generated);
              void save(generated, "Used the generated JSON-LD");
            }}
          >
            {!busy && <Wand2 className="h-4 w-4" />} {text.trim() ? "Regenerate from the article" : "Generate JSON-LD"}
          </Button>
          <Button loading={busy} disabled={text === (draft.meta.schema ?? "")} onClick={() => save(text, "Saved the JSON-LD")}>
            {!busy && <Save className="h-4 w-4" />} Save edits
          </Button>
          <Button
            variant="ghost"
            disabled={!text.trim()}
            onClick={async () => {
              await navigator.clipboard.writeText(tag);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy &lt;script&gt; tag
          </Button>
        </div>
        {text.trim() && (
          <div className="rounded-md bg-surface-2 px-3 py-2 text-[12.5px]">
            <div className={v.valid ? "font-medium text-good-ink" : "font-medium text-critical-ink"}>{v.parseError ? "Invalid JSON" : v.valid ? `Valid: ${v.types.join(", ")}` : `${v.issues.filter((i) => i.level === "error").length} error(s)`}</div>
            <ul className="mt-1 space-y-0.5">
              {v.issues.map((i, k) => (
                <li key={k} className={i.level === "error" ? "text-critical-ink" : "text-warning-ink"}>
                  {i.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
