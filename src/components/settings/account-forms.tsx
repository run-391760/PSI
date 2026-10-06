"use client";

import { Check, LogOut, Monitor, Moon, Sun, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState, useTransition } from "react";
import { changePasswordAction, deleteAccountAction, signOutOtherSessionsAction, updateBudgetAction, updateProfileAction } from "@/app/(app)/settings/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Checkbox, Field, Input } from "@/components/ui/input";

type Status = { tone: "good" | "critical"; text: string } | null;
const Msg = ({ s }: { s: Status }) => (s ? <Callout tone={s.tone}>{s.text}</Callout> : null);

// ------------------------------------------------------------------------------------- profile

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    start(async () => {
      const res = await updateProfileAction({ name: value });
      if (!res.ok) return setStatus({ tone: "critical", text: res.error });
      setStatus({ tone: "good", text: "Profile saved." });
      router.refresh();
    });
  };
  return (
    <form onSubmit={submit} className="space-y-3.5">
      <Msg s={status} />
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Full name" htmlFor="pf-name">
          <Input id="pf-name" value={value} onChange={(e) => setValue(e.target.value)} maxLength={80} required autoComplete="name" />
        </Field>
        <Field label="Email" htmlFor="pf-email" hint="Used to sign in. Contact the administrator to change it.">
          <Input id="pf-email" value={email} disabled readOnly />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={pending} disabled={!value.trim() || value.trim() === name}>
          Save profile
        </Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------------------------ password

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const mismatch = confirm.length > 0 && next !== confirm;
  const short = next.length > 0 && next.length < 10;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    start(async () => {
      const res = await changePasswordAction({ current, next, confirm, signOutOthers });
      if (!res.ok) return setStatus({ tone: "critical", text: res.error });
      setCurrent("");
      setNext("");
      setConfirm("");
      setStatus({ tone: "good", text: `Password changed.${res.data.signedOut ? ` Signed out ${res.data.signedOut} other session${res.data.signedOut === 1 ? "" : "s"}.` : ""}` });
    });
  };
  return (
    <form onSubmit={submit} className="space-y-3.5">
      <Msg s={status} />
      <Field label="Current password" htmlFor="pw-current">
        <Input id="pw-current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
      </Field>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="New password" htmlFor="pw-next" hint="At least 10 characters." error={short ? "Use at least 10 characters." : undefined}>
          <Input id="pw-next" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} maxLength={128} required />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-confirm" error={mismatch ? "The passwords do not match." : undefined}>
          <Input id="pw-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" maxLength={128} required />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-[13px] text-text-2">
        <Checkbox checked={signOutOthers} onChange={(e) => setSignOutOthers(e.target.checked)} /> Sign out of all other sessions
      </label>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={pending} disabled={!current || !next || mismatch || short}>
          Change password
        </Button>
      </div>
    </form>
  );
}

export function SignOutOthers({ others }: { others: number }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <Msg s={status} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-text-2">
          {others ? (
            <>
              You are signed in on <span className="font-medium text-text">{others + 1}</span> devices or browsers, including this one.
            </>
          ) : (
            "This is your only active session."
          )}
        </p>
        <Button
          loading={pending}
          disabled={!others}
          onClick={() =>
            start(async () => {
              const res = await signOutOtherSessionsAction();
              if (!res.ok) return setStatus({ tone: "critical", text: res.error });
              setStatus({ tone: "good", text: `Signed out ${res.data.signedOut} other session${res.data.signedOut === 1 ? "" : "s"}.` });
              router.refresh();
            })
          }
        >
          {!pending && <LogOut className="h-4 w-4" />} Sign out other sessions
        </Button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------------------- budget

export function BudgetForm({ budget, cap, spend }: { budget: number; cap: number; spend: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(budget));
  const [status, setStatus] = useState<Status>(null);
  const [pending, start] = useTransition();
  const n = Number(value);
  const invalid = value.trim() === "" || !Number.isFinite(n) || n < 0 || n > cap;
  const presets = [5, 10, 25, 50, 100, 250].filter((p) => p <= cap);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    start(async () => {
      const res = await updateBudgetAction({ usd: n });
      if (!res.ok) return setStatus({ tone: "critical", text: res.error });
      setStatus({ tone: "good", text: `Monthly budget set to $${res.data.usd.toFixed(2)}.` });
      router.refresh();
    });
  };
  return (
    <form onSubmit={submit} className="space-y-3.5">
      <Msg s={status} />
      <Field
        label="Monthly budget (USD)"
        htmlFor="b-usd"
        hint={`Between $0 and $${cap} (deployment cap MAX_MONTHLY_API_USD). $0 blocks all paid calls.`}
        error={value.trim() !== "" && invalid ? `Enter an amount between 0 and ${cap}.` : undefined}
      >
        <div className="relative max-w-56">
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[13px] text-text-3">$</span>
          <Input id="b-usd" type="number" inputMode="decimal" min={0} max={cap} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} className="pl-6" />
        </div>
      </Field>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button key={p} type="button" onClick={() => setValue(String(p))} className={cn("rounded-full border px-2.5 py-0.5 text-[12px]", n === p ? "border-brand bg-brand-soft text-brand-ink" : "border-border text-text-2 hover:border-border-strong")}>
            ${p}
          </button>
        ))}
      </div>
      {!invalid && n < spend && <Callout tone="warning">You have already spent ${spend.toFixed(2)} this month. With this budget, new paid calls are blocked until next month.</Callout>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={pending} disabled={invalid || n === budget}>
          Save budget
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------- appearance

type Theme = "light" | "dark" | "system";
const KEY = "synapse.theme";

function applyTheme(t: Theme) {
  const root = document.documentElement;
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {}
  if (t === "system") delete root.dataset.theme;
  else root.dataset.theme = t;
}

export function ThemeSelector() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {}
    setTheme(saved === "dark" || saved === "light" ? saved : "system");
  }, []);
  const options: { id: Theme; label: string; icon: typeof Sun; note: string }[] = [
    { id: "light", label: "Light", icon: Sun, note: "Bright surfaces" },
    { id: "dark", label: "Dark", icon: Moon, note: "Easy on the eyes at night" },
    { id: "system", label: "System", icon: Monitor, note: "Follow your OS setting" },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Theme">
      {options.map((o) => {
        const on = theme === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => {
              setTheme(o.id);
              applyTheme(o.id);
            }}
            className={cn("relative overflow-hidden rounded-lg border text-left transition-colors", on ? "border-brand ring-1 ring-brand" : "border-border hover:border-border-strong")}
          >
            <div className={cn("flex h-20 gap-1.5 p-2.5", o.id === "dark" ? "bg-[#0a0d14]" : o.id === "light" ? "bg-[#f5f6f8]" : "bg-[linear-gradient(90deg,#f5f6f8_50%,#0a0d14_50%)]")} aria-hidden>
              <div className="w-5 rounded bg-[#0f1422]" />
              <div className="flex flex-1 flex-col gap-1.5">
                <div className={cn("h-3 rounded", o.id === "dark" ? "bg-[#1d2331]" : "bg-white")} />
                <div className={cn("flex-1 rounded", o.id === "dark" ? "bg-[#121620]" : "bg-white")} />
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2">
              <o.icon className="h-4 w-4 text-text-3" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-text">{o.label}</div>
                <div className="text-[11.5px] text-text-3">{o.note}</div>
              </div>
              {on && <Check className="h-4 w-4 text-brand-ink" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------- danger zone

export function DeleteAccount({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const close = () => {
    setOpen(false);
    setTyped("");
    setPassword("");
    setError(null);
  };
  const ok = typed.trim().toLowerCase() === email.toLowerCase() && password.length > 0;
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        <Trash2 className="h-4 w-4" /> Delete account
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Delete your account?"
        description="This permanently deletes your account and everything in it."
        size="sm"
        dismissible={!pending}
        error={error}
        onSubmit={() =>
          ok &&
          start(async () => {
            setError(null);
            const res = await deleteAccountAction({ email: typed, password });
            if (res && !res.ok) setError(res.error);
          })
        }
        footer={
          <>
            <Button type="button" variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={!ok || pending} loading={pending}>
              Delete forever
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[13px] text-text-2">
          <p>All projects, audits, tracked keywords, reports, schedules, alerts and usage history will be removed. This cannot be undone.</p>
          <Field label={<>Type <span className="font-semibold text-text">{email}</span> to confirm</>} htmlFor="del-email">
            <Input id="del-email" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus />
          </Field>
          <Field label="Your password" htmlFor="del-password">
            <Input id="del-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
