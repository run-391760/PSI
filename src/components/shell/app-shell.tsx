"use client";

import { type ReactNode, useCallback, useState } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({ user, unread, logoutAction, children }: { user: { name: string; email: string }; unread: number; logoutAction: () => Promise<void>; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const close = useCallback(() => setMobileOpen(false), []);
  return (
    <div className="flex min-h-screen">
      <Sidebar mobileOpen={mobileOpen} onClose={close} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} unread={unread} onMenu={() => setMobileOpen(true)} logoutAction={logoutAction} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
