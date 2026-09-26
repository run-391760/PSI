"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/input";
import { loginAction, registerAction } from "./actions";

export function AuthForm({ mode, next, inviteRequired }: { mode: "login" | "register"; next?: string; inviteRequired?: boolean }) {
  const [state, action, pending] = useActionState(mode === "login" ? loginAction : registerAction, undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error && <Callout tone="critical">{state.error}</Callout>}
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
