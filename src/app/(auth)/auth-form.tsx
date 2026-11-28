"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/input";
import { loginAction, registerAction } from "./actions";

export function AuthForm({ mode, next, inviteRequired, google, initialError }: { mode: "login" | "register"; next?: string; inviteRequired?: boolean; google?: boolean; initialError?: string }) {
  const [state, action, pending] = useActionState(mode === "login" ? loginAction : registerAction, undefined);
  const error = state?.error ?? initialError;
  return (
    <form action={action} className="space-y-4">
      {error && <Callout tone="critical">{error}</Callout>}
      {google && (
        <>
          <GoogleButton next={next} label={mode === "login" ? "Continue with Google" : "Sign up with Google"} />
          <div className="flex items-center gap-3 text-[12px] text-text-3" role="separator">
            <span className="h-px flex-1 bg-border" />
            or use your email
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}
      {mode === "register" && (
        <Field label="Name" htmlFor="name">
          <Input id="name" name="name" autoComplete="name" required />
        </Field>
      )}
      <Field label="Work email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password" hint={mode === "register" ? "At least 10 characters." : undefined}>
        <Input id="password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={10} required />
      </Field>
      {mode === "register" && inviteRequired && (
        <Field label="Invite code" htmlFor="invite" hint="Sign-ups are invite-only. Ask your workspace admin for the code.">
          <Input id="invite" name="invite" autoComplete="off" required />
        </Field>
      )}
      {next && <input type="hidden" name="next" value={next} />}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={pending}>
        {mode === "login" ? "Sign in" : "Create account"}
      </Button>
      <p className="text-center text-[13px] text-text-2">
        {mode === "login" ? (
          <>
            New to SynapseSEO?{" "}
            <Link href="/register" className="font-medium text-link hover:underline">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-link hover:underline">
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

/** "Continue with Google" (full-page navigation: the OAuth flow runs through /api/auth/google/*). */
function GoogleButton({ next, label }: { next?: string; label: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <a
      href={`/api/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ""}`}
      onClick={() => setBusy(true)}
      aria-busy={busy}
      className="flex h-10 w-full items-center justify-center gap-2.5 rounded-md border border-border-strong bg-surface text-[14px] font-medium text-text shadow-card hover:bg-surface-3 aria-busy:opacity-70"
    >
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      {busy ? "Opening Google…" : label}
    </a>
  );
}
