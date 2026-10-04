import type { ReactNode } from "react";
import { requirePageUser } from "@/lib/auth";
import { getUiPrefs } from "@/lib/cx/ui/prefs";
import { AppShellClient } from "./app-shell-client";

/**
 * App chrome (sidebar + topbar). Loads the user's display preferences on the server so focus mode,
 * density, collapsed sidebar, menu customisation and hidden panels apply on first paint.
 */
export async function AppShell(props: { user: { name: string; email: string }; unread: number; logoutAction: () => Promise<void>; available?: Record<string, boolean>; children: ReactNode }) {
  const user = await requirePageUser(); // cached per request (already resolved by the layout)
  const prefs = await getUiPrefs(user.id);
  return <AppShellClient {...props} prefs={prefs} />;
}
