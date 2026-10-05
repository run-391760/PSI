"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { isFocusShortcut, type UiPrefs } from "@/lib/cx/ui/prefs-logic";
import { isCxPath } from "./cx-nav";
import { CxHeader } from "./cx-header";
import { CxMenu } from "./cx-menu";
import { CxSidebar } from "./cx-sidebar";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { UiPrefsProvider, useUiPrefs } from "./ui-prefs";
import "./declutter.css";
import "./cx-shell.css";

const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

type FrameProps = { user: { name: string; email: string }; unread: number; logoutAction: () => Promise<void>; available?: Record<string, boolean>; children: ReactNode };

function useFocusShortcuts() {
  const { prefs, update } = useUiPrefs();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isFocusShortcut(e)) {
        e.preventDefault();
        update({ focus: !prefs.focus });
      } else if (e.key === "Escape" && prefs.focus && !editable(e.target) && !document.querySelector("dialog[open]") && !document.querySelector("[aria-modal='true']:not([inert])")) {
        update({ focus: false });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [prefs.focus, update]);
  return prefs;
}

/** SEO workspace: dark full-height sidebar + light topbar. */
function SeoFrame({ user, unread, logoutAction, available, children }: FrameProps) {
  const prefs = useFocusShortcuts();
  const [mobileOpen, setMobileOpen] = useState(false);
  const close = useCallback(() => setMobileOpen(false), []);
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

/**
 * CX workspace (Konnect layout): full-width brand header with tabs, a per-tab white sidebar that
 * becomes an icon rail (collapsed, focus mode, or when a <SectionPanel> is present), and the hamburger
 * menu. Phones get the sidebar inside the hamburger drawer.
 */
function CxFrame({ user, unread, logoutAction, children }: FrameProps) {
  const prefs = useFocusShortcuts();
  const [menuOpen, setMenuOpen] = useState(false);
  const close = useCallback(() => setMenuOpen(false), []);
  return (
    <div
      className="group/shell cx-shell flex min-h-screen flex-col bg-bg"
      data-shell="cx"
      data-focus={prefs.focus ? "on" : "off"}
      data-density={prefs.density}
      data-rail={prefs.focus || prefs.collapsed ? "on" : "off"}
    >
      <CxHeader user={user} unread={unread} onMenu={() => setMenuOpen(true)} logoutAction={logoutAction} />
      <div className="flex min-w-0 flex-1">
        <CxSidebar />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <CxMenu open={menuOpen} onClose={close} logoutAction={logoutAction} />
    </div>
  );
}

function Frame(props: FrameProps) {
  const cx = isCxPath(usePathname());
  return cx ? <CxFrame {...props} /> : <SeoFrame {...props} />;
}

export function AppShellClient({ prefs, ...props }: { prefs: UiPrefs } & FrameProps) {
  return (
    <UiPrefsProvider initial={prefs}>
      <Frame {...props} />
    </UiPrefsProvider>
  );
}
