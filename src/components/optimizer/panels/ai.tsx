"use client";

import { ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { aiRewriteSectionAction, applySafeFixesAction } from "@/app/(app)/optimizer/actions";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/input";
import { bySeverity } from "@/lib/optimizer/analyze";
import { featureById } from "@/lib/optimizer/features";
import { parseDraft } from "@/lib/optimizer/parse";
import type { Draft, FixOption, Report } from "@/lib/optimizer/types";
import { FixActions, tryFix } from "../fix-actions";
import { flashScore } from "../score-flash";
import { SeverityBadge } from "../ui";

/** Fix-It Recommendations + One-Click Apply & Re-score across every module. */
export function FixItList({ report, draftId, aiOn }: { report: Report; draftId: string; aiOn: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const withFixes = report.findings.filter((f) => f.fixes?.length && f.status !== "pass").sort(bySeverity);
  const safe = withFixes.flatMap((f) => (f.fixes ?? []).filter((o) => o.safe && o.fix));
  return (
    <Card>
      <CardHeader
        title="Fix-it recommendations"
        description={`${withFixes.length} checks have a fix. Deterministic fixes preview exactly what changes; Claude fixes are written on request and shown before applying.`}
        actions={
          <Button
            variant="primary"
            loading={busy}
            disabled={!safe.length}
            title={safe.length ? safe.map((o) => o.label).join("\n") : "No safe fixes left"}
            onClick={async () => {
              setBusy(true);
              const r = await applySafeFixesAction(draftId);
              setBusy(false);
              if (r.ok) flashScore({ title: `Applied ${r.data.applied.length} safe fixes`, before: r.data.before, after: r.data.after, status: r.data.status, detail: r.data.applied.slice(0, 8).join("\n") });
              else flashScore({ title: "Nothing applied", detail: r.error, error: true });
              router.refresh();
            }}
          >
            {!busy && <ShieldCheck className="h-4 w-4" />} Apply {safe.length} safe fix{safe.length === 1 ? "" : "es"}
          </Button>
        }
      />
      <CardBody>
        {withFixes.length ? (
          <ul className="divide-y divide-border">
            {withFixes.map((f) => {
              const def = featureById(f.feature)!;
              return (
                <li key={f.feature} className="py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SeverityBadge severity={f.severity} />
                    <span className="text-[13.5px] font-medium text-text">{def.name}</span>
                  </div>
                  <p className="mt-0.5 mb-2 text-[12.5px] text-text-2">{f.blocker ?? f.how ?? f.summary}</p>
                  <FixActions draftId={draftId} feature={f.feature} fixes={f.fixes!} aiOn={aiOn} />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[13px] text-text-2">No fixes pending.</p>
        )}
      </CardBody>
    </Card>
  );
}

/** Ask Claude to rewrite any section with your own instruction; preview, then apply & re-score. */
export function SectionRewriter({ draft, aiOn }: { draft: Draft; aiOn: boolean }) {
  const router = useRouter();
  const sections = useMemo(() => parseDraft(draft.body).headings.filter((h) => h.level >= 2), [draft.body]);
  const [target, setTarget] = useState("__intro");
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{ note: string; option: FixOption } | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const discard = () => {
    setProposal(null);
    setApplyError(null);
  };
  return (
    <Card>
      <CardHeader title="Rewrite a section with Claude" description={aiOn ? "Describe the change; Claude rewrites only that part, you review it, then apply & re-score." : "Add an AI key (Anthropic, OpenAI or Gemini) on the server to enable."} />
      <CardBody className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[260px_1fr]">
          <Field label="Section">
            <Select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="__intro">Introduction</option>
              {sections.map((h) => (
                <option key={`${h.line}`} value={h.text}>
                  {"— ".repeat(h.level - 2)}
                  {h.text}
                </option>
              ))}
              <option value="__conclusion">Conclusion</option>
            </Select>
          </Field>
          <Field label="Instruction">
            <Textarea rows={2} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. Add the eligibility criteria as a bulleted list and a sentence on lateral entry; keep it under 200 words." />
          </Field>
        </div>
        <Button
          variant="primary"
          disabled={busy || !aiOn || ask.trim().length < 3}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const r = await aiRewriteSectionAction(draft.id, target, ask);
            setBusy(false);
            if (r.ok) setProposal({ note: r.data.note, option: r.data.options[0] });
            else setError(r.error);
          }}
        >
          {!busy && <Sparkles className="h-4 w-4" />} Propose rewrite
        </Button>
        {error && <p className="text-[13px] text-critical-ink">{error}</p>}
        <Dialog
          open={!!proposal}
          onClose={discard}
          title="Proposed rewrite"
          description={proposal?.note}
          size="lg"
          dismissible={!applying}
          error={applyError}
          footer={
            <>
              <Button variant="ghost" onClick={discard} disabled={applying}>
                Discard
              </Button>
              <Button
                variant="primary"
                loading={applying}
                onClick={async () => {
                  if (!proposal?.option.fix) return;
                  setApplying(true);
                  setApplyError(null);
                  const err = await tryFix(draft.id, proposal.option.fix, `Claude rewrite: ${target.startsWith("__") ? target.slice(2) : target}`);
                  setApplying(false);
                  if (err) return setApplyError(err);
                  discard();
                  setAsk("");
                  router.refresh();
                }}
              >
                Apply &amp; re-score
              </Button>
            </>
          }
        >
          <pre className="overflow-x-auto rounded-md border border-border bg-surface-2 p-3 text-[12.5px] break-words whitespace-pre-wrap text-text">{proposal?.option.description}</pre>
        </Dialog>
      </CardBody>
    </Card>
  );
}
