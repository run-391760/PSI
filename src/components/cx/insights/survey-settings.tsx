"use client";

import { Download, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveSurveySettingsAction } from "@/app/(app)/cx/surveys/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { downloadCsv } from "@/lib/csv";
import { DEFAULT_TEMPLATE, fillSurveyTemplate, inlineRatingLinks, type SurveySettings } from "@/lib/cx/insights/survey-defs";

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function SurveySettingsButton({ brand, surveyId, kind, question, settings, channels, classifications, fields }: {
  brand: string; surveyId: string; kind: "csat" | "nps" | "custom"; question: string; settings: SurveySettings; channels: string[];
  classifications: { id: string; label: string }[]; fields: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [s, setS] = useState(settings);
  const [chan, setChan] = useState((settings.conditions.channels ?? []).join(", "));
  const [tags, setTags] = useState((settings.conditions.tags ?? []).join(", "));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const c = s.conditions;
  const url = "https://example.com/s/…?t=…";
  const preview = fillSurveyTemplate(s.emailTemplate, { name: "Alex", ticket: 1042, brand: "Your brand", question, link: url, ratingLinks: s.inline && kind !== "custom" ? inlineRatingLinks(kind, url) : "" });
  const togglePriority = (p: "low" | "normal" | "high" | "urgent") => setS({ ...s, conditions: { ...c, priorities: (c.priorities ?? []).includes(p) ? (c.priorities ?? []).filter((x) => x !== p) : [...(c.priorities ?? []), p] } });
  return (
    <>
      <Button onClick={() => setOpen(true)}><Mail className="h-4 w-4" /> Delivery settings</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="xl"
        title="Delivery settings"
        description="How and when this survey is sent after a ticket is resolved, and what respondents see."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = await saveSurveySettingsAction(brand, surveyId, { ...s, conditions: { ...c, channels: list(chan), tags: list(tags).map((t) => t.toLowerCase()) } });
                  if (!r.ok) return setError(r.error);
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              Save settings
            </Button>
          </>
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            {error && <Callout tone="critical">{error}</Callout>}
            <Field label="Send when a ticket is" htmlFor="ss-trigger">
              <Select id="ss-trigger" value={s.trigger} onChange={(e) => setS({ ...s, trigger: e.target.value as SurveySettings["trigger"] })}>
                <option value="solved">Resolved (solved)</option>
                <option value="closed">Closed</option>
              </Select>
            </Field>
            <Field label="Email subject" htmlFor="ss-subj"><Input id="ss-subj" value={s.emailSubject} onChange={(e) => setS({ ...s, emailSubject: e.target.value })} /></Field>
            <Field label="Email template" htmlFor="ss-tpl" hint="Placeholders: {{name}} {{ticket}} {{brand}} {{question}} {{link}} {{rating_links}}">
              <Textarea id="ss-tpl" rows={6} value={s.emailTemplate} onChange={(e) => setS({ ...s, emailTemplate: e.target.value })} />
            </Field>
            <Button size="sm" variant="ghost" onClick={() => setS({ ...s, emailTemplate: DEFAULT_TEMPLATE })}>Reset template</Button>
            {kind !== "custom" && (
              <label className="flex items-start gap-2 text-[13px] text-text">
                <Checkbox checked={s.inline} onChange={(e) => setS({ ...s, inline: e.target.checked })} className="mt-0.5" />
                <span>Inline rating in the email body<span className="block text-[12px] text-text-3">One link per score; clicking it records the rating and offers an optional comment.</span></span>
              </label>
            )}
            <label className="flex items-start gap-2 text-[13px] text-text">
              <Checkbox checked={s.socialEmail} onChange={(e) => setS({ ...s, socialEmail: e.target.checked })} className="mt-0.5" />
              <span>Email the survey for social and other tickets when the contact&apos;s email is known<span className="block text-[12px] text-text-3">Sent hourly through your brand mailbox (email channel).</span></span>
            </label>
            <Field label="After submitting, redirect to (optional)" htmlFor="ss-redir"><Input id="ss-redir" value={s.redirectUrl} onChange={(e) => setS({ ...s, redirectUrl: e.target.value })} placeholder="https://example.com/thanks" /></Field>
            <Field label="Background image URL (optional)" htmlFor="ss-bg"><Input id="ss-bg" value={s.background} onChange={(e) => setS({ ...s, background: e.target.value })} placeholder="https://example.com/banner.jpg" /></Field>
          </div>
          <div className="space-y-3">
            <div className="text-[12.5px] font-semibold text-text">Conditions <span className="font-normal text-text-3">(empty = every ticket)</span></div>
            <Field label="Channels" htmlFor="ss-ch" hint={channels.length ? `In use: ${channels.join(", ")}` : undefined}><Input id="ss-ch" value={chan} onChange={(e) => setChan(e.target.value)} placeholder="email, livechat" /></Field>
            <div>
              <div className="mb-1 text-[12.5px] font-medium text-text">Priorities</div>
              <div className="flex flex-wrap gap-3">
                {(["urgent", "high", "normal", "low"] as const).map((p) => (
                  <label key={p} className="flex items-center gap-1.5 text-[13px] text-text"><Checkbox checked={(c.priorities ?? []).includes(p)} onChange={() => togglePriority(p)} /> {p}</label>
                ))}
              </div>
            </div>
            <Field label="Tags (any of)" htmlFor="ss-tags"><Input id="ss-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="billing, vip" /></Field>
            {classifications.length > 0 ? (
              <Field label="Classification (any of)" htmlFor="ss-class">
                <Select id="ss-class" multiple value={c.classificationIds ?? []} onChange={(e) => setS({ ...s, conditions: { ...c, classificationIds: [...e.target.selectedOptions].map((o) => o.value) } })} className="h-24">
                  {classifications.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </Select>
              </Field>
            ) : null}
            {fields.length > 0 ? (
              <div>
                <div className="mb-1 text-[12.5px] font-medium text-text">Field equals</div>
                {(c.fields ?? []).map((f, i) => (
                  <div key={i} className="mb-1.5 flex gap-2">
                    <Select aria-label="Field" value={f.key} onChange={(e) => setS({ ...s, conditions: { ...c, fields: (c.fields ?? []).map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) } })}>
                      {fields.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                    </Select>
                    <Input aria-label="Value" value={f.value} onChange={(e) => setS({ ...s, conditions: { ...c, fields: (c.fields ?? []).map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) } })} />
                    <Button size="sm" variant="ghost" onClick={() => setS({ ...s, conditions: { ...c, fields: (c.fields ?? []).filter((_, j) => j !== i) } })}>Remove</Button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setS({ ...s, conditions: { ...c, fields: [...(c.fields ?? []), { key: fields[0].key, value: "" }] } })}>Add field condition</Button>
              </div>
            ) : (
              <p className="text-[12px] text-text-3">Classification and custom-field conditions become available once fields are defined in CX settings.</p>
            )}
            <div>
              <div className="mb-1 text-[12.5px] font-semibold text-text">Email preview</div>
              <pre className="scroll-thin max-h-56 overflow-auto rounded-md border border-border bg-surface-2 p-2.5 text-[12px] whitespace-pre-wrap text-text-2">{preview}</pre>
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
}

export function AgentReportCsv({ name, rows }: { name: string; rows: { agent: string; invites: number; delivered: number; responses: number; responseRate: number | null; avg: number | null; satisfiedPct: number | null }[] }) {
  return (
    <Button size="sm" onClick={() => downloadCsv(`${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-agent-report.csv`, [["Agent", "Surveys sent", "Delivered", "Responses", "Response rate %", "Average score", "Satisfied %"], ...rows.map((r) => [r.agent, r.invites, r.delivered, r.responses, r.responseRate == null ? "n/a" : r.responseRate.toFixed(1), r.avg == null ? "n/a" : r.avg.toFixed(2), r.satisfiedPct == null ? "n/a" : r.satisfiedPct.toFixed(1)])])}>
      <Download className="h-3.5 w-3.5" /> CSV
    </Button>
  );
}
