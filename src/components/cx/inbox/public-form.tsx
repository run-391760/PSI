"use client";

import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { Field, Input, Textarea } from "@/components/ui/input";

/** Hosted contact form: posts JSON (progressive enhancement over a plain HTML form post). */
export function PublicForm({ channelId, askPhone, askSubject, color, success, initialError }: { channelId: string; askPhone: boolean; askSubject: boolean; color: string; success: string; initialError: string | null }) {
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (done)
    return (
      <div className="py-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-good-ink" />
        <h2 className="mt-3 text-[17px] font-semibold text-text">Message sent</h2>
        <p className="mt-1 text-[13.5px] text-text-2">{success}</p>
      </div>
    );
  return (
    <form
      action={`/api/cx/forms/${channelId}`}
      method="post"
      className="mt-5 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const data = Object.fromEntries(new FormData(e.currentTarget).entries());
        try {
          const r = await fetch(`/api/cx/forms/${channelId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...data, pageUrl: location.href }) });
          const d = (await r.json().catch(() => ({}))) as { error?: string };
          if (!r.ok) setError(d.error ?? "Something went wrong.");
          else setDone(true);
        } catch {
          setError("Network error. Please try again.");
        }
        setBusy(false);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="f-name">
          <Input id="f-name" name="name" required maxLength={80} autoComplete="name" />
        </Field>
        <Field label="Email" htmlFor="f-email">
          <Input id="f-email" name="email" type="email" required maxLength={200} autoComplete="email" />
        </Field>
      </div>
      {askPhone && (
        <Field label="Phone (optional)" htmlFor="f-phone">
          <Input id="f-phone" name="phone" type="tel" maxLength={40} autoComplete="tel" />
        </Field>
      )}
      {askSubject && (
        <Field label="Subject" htmlFor="f-subject">
          <Input id="f-subject" name="subject" maxLength={200} />
        </Field>
      )}
      <Field label="Message" htmlFor="f-message">
        <Textarea id="f-message" name="message" required rows={6} maxLength={10000} />
      </Field>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      {error && <p className="text-[13px] text-critical-ink">{error}</p>}
      <button type="submit" disabled={busy} className="h-10 w-full rounded-md text-[14px] font-semibold text-white disabled:opacity-60" style={{ background: color }}>
        {busy ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
