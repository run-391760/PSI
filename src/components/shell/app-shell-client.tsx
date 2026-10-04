"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { isFocusShortcut, type UiPrefs } from "@/lib/cx/ui/prefs-logic";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { UiPrefsProvider, useUiPrefs } from "./ui-prefs";
import "./declutter.css";

const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

function Frame({ user, unread, logoutAction, available, children }: { user: { name: string; email: string }; unread: number; logoutAction: () => Promise<void>; available?: Record<string, boolean>; children: ReactNode }) {
  const { prefs, update } = useUiPrefs();
  const [mobileOpen, setMobileOpen] = useState(false);
  const close = useCallback(() => setMobileOpen(false), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isFocusShortcut(e)) {
        e.preventDefault();
        update({ focus: !prefs.focus });
      } else if (e.key === "Escape" && prefs.focus && !editable(e.target) && !document.querySelector("dialog[open]")) {
        update({ focus: false });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [prefs.focus, update]);
  return (
    <div className="group/shell flex min-h-screen" data-focus={prefs.focus ? "on" : "off"} data-density={prefs.density}>
      <Sidebar mobileOpen={mobileOpen} onClose={close} available={available} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} unread={unread} onMenu={() => setMobileOpen(true)} logoutAction={logoutAction} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

export function AppShellClient({ prefs, ...props }: { prefs: UiPrefs; user: { name: string; email: string }; unread: number; logoutAction: () => Promise<void>; available?: Record<string, boolean>; children: ReactNode }) {
  return (
    <UiPrefsProvider initial={prefs}>
      <Frame {...props} />
    </UiPrefsProvider>
  );
}
