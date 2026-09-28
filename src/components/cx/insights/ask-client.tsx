"use client";

import { KeyRound, Send, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { aiSignalAction, askAction, briefNowAction, briefSettingsAction, connectorTokenAction, revokeConnectorAction } from "@/app/(app)/cx/ask/actions";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/input";

const EXAMPLES = ["Which channel has the slowest first response this month?", "Is CSAT improving compared with the previous period?", "Which agents breach SLA most often?", "What are customers contacting us about most?"];

export function AskBox({ brand, days }: { brand: string; days: number }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<{ q: string; a: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ask = (question: string) =>
    start(async () => {
      setError(null);
      const r = await askAction(brand, question, days);
      if (!r.ok) return setError(r.error);
      setAnswer({ q: question, a: r.data.answer });
      setQ("");
      router.refresh();
    });
  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) ask(q.trim());
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about volume, speed, SLA, CSAT, agents…" aria-label="Question" maxLength={500} className="min-w-0 flex-1" />
        <Button type="submit" variant="primary" loading={pending} disabled={!q.trim()}>
          <Send className="h-4 w-4" /> Ask
        </Button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((x) => (
          <button key={x} type="button" disabled={pending} onClick={() => ask(x)} className="rounded-full border border-border bg-surface px-2.5 py-1 text-[12px] text-text-2 hover:bg-surface-3 disabled:opacity-60">
            {x}
          </button>
        ))}
      </div>
      {error && <Callout tone="critical">{error}</Callout>}
      {answer && (
        <div className="rounded-md border border-border bg-surface-2 p-3">
          <div className="mb-1 text-[12.5px] font-semibold text-text">{answer.q}</div>
          <p className="text-[13.5px] whitespace-pre-line text-text">{answer.a}</p>
        </div>
      )}
    </div>
  );
}

export function BriefSettings({ brand, cadence: c0, recipients: r0, ai, mailbox }: { brand: string; cadence: "off" | "weekly" | "monthly"; recipients: string[]; ai: boolean; mailbox: boolean }) {
  const router = useRouter();
  const [cadence, setCadence] = useState(c0);
  const [recipients, setRecipients] = useState(r0.join(", "));
  const [msg, setMsg] = useState<{ tone: "good" | "critical"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      {msg && <Callout tone={msg.tone}>{msg.text}</Callout>}
      <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
        <Field label="Schedule" htmlFor="br-cad">
          <Select id="br-cad" value={cadence} onChange={(e) => setCadence(e.target.value as typeof cadence)}>
            <option value="off">Off</option>
            <option value="weekly">Weekly (Mondays)</option>
            <option value="monthly">Monthly (1st)</option>
          </Select>
        </Field>
        <Field label="Email to" htmlFor="br-to" hint={mailbox ? "Sent through your brand mailbox" : "No email channel connected: briefs are kept here only"}>
          <Input id="br-to" value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="ceo@example.com, cx-lead@example.com" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await briefSettingsAction(brand, cadence, recipients.split(/[\s,;]+/).filter(Boolean));
              setMsg(r.ok ? { tone: "good", text: "Brief schedule saved." } : { tone: "critical", text: r.error });
              if (r.ok) router.refresh();
            })
          }
        >
          Save schedule
        </Button>
        {ai && (
          <>
            <Button disabled={pending} onClick={() => start(async () => { const r = await briefNowAction(brand, "weekly"); setMsg(r.ok ? { tone: "good", text: "Weekly brief generated." } : { tone: "critical", text: r.error }); if (r.ok) router.refresh(); })}>
              <Sparkles className="h-4 w-4" /> Generate weekly now
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await briefNowAction(brand, "monthly"); setMsg(r.ok ? { tone: "good", text: "Monthly brief generated." } : { tone: "critical", text: r.error }); if (r.ok) router.refresh(); })}>
              Monthly now
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function ConnectorTokens({ brand, tokens }: { brand: string; tokens: { token: string; label: string; created_at: string; last_used_at: string | null }[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const endpoint = `${origin}/api/cx/insights/mcp`;
  return (
    <div className="space-y-3">
      {error && <Callout tone="critical">{error}</Callout>}
      <Field label="Server URL" htmlFor="mcp-url"><Input id="mcp-url" readOnly value={endpoint} onFocus={(e) => e.target.select()} /></Field>
      <div className="flex flex-wrap gap-2">
        <Input aria-label="Token label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label, e.g. Leadership Claude workspace" className="min-w-0 flex-1" />
        <Button variant="primary" loading={pending} onClick={() => start(async () => { const r = await connectorTokenAction(brand, label); if (r.ok) { setFresh(r.data.token); setLabel(""); router.refresh(); } else setError(r.error); })}>
          <KeyRound className="h-4 w-4" /> Create token
        </Button>
      </div>
      {fresh && (
        <Callout tone="good" title="Token created">
          Use it as a bearer token (Authorization: Bearer …). It gives read-only access to aggregated metrics of this brand.
          <Input readOnly value={fresh} className="mt-2 font-mono text-[12px]" onFocus={(e) => e.target.select()} aria-label="New token" />
        </Callout>
      )}
      <div className="divide-y divide-border rounded-md border border-border">
        {tokens.length === 0 && <p className="p-3 text-[13px] text-text-3">No connector tokens.</p>}
        {tokens.map((t) => (
          <div key={t.token} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
            <span className="font-medium text-text">{t.label || "MCP connector"}</span>
            <span className="font-mono text-[12px] text-text-3">{t.token.slice(0, 6)}…</span>
            <span className="text-[12px] text-text-3">{t.last_used_at ? `last used ${new Date(t.last_used_at).toISOString().slice(0, 16).replace("T", " ")} UTC` : "never used"}</span>
            <Button size="icon" variant="ghost" className="ml-auto" aria-label="Revoke token" onClick={() => confirm("Revoke this token? Connectors using it stop working.") && start(async () => { const r = await revokeConnectorAction(brand, t.token); if (r.ok) router.refresh(); else setError(r.error); })}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AiSignalButton({ brand, ticketId }: { brand: string; ticketId: string }) {
  const [r, setR] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (r) return <span className="text-[12px] text-text-2">{r}</span>;
  return (
    <Button size="sm" variant="ghost" loading={pending} onClick={() => start(async () => { const x = await aiSignalAction(brand, ticketId); setR(x.ok ? `AI: CSAT ${x.data.csat.toFixed(1)}, churn ${Math.round(x.data.churn)}. ${x.data.reason}` : x.error); })}>
      <Sparkles className="h-3.5 w-3.5" /> AI check
    </Button>
  );
}
