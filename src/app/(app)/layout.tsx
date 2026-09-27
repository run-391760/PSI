import { logoutAction } from "@/app/(auth)/actions";
import { requirePageUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { AppShell } from "@/components/shell/app-shell";
import { demoAllowed, providerStatus } from "@/lib/data-mode";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const [{ count }] = await query<{ count: number }>("SELECT count(*)::int AS count FROM notifications WHERE owner_id=$1 AND read_at IS NULL", [user.id]);
  return (
    <AppShell user={{ name: user.name, email: user.email }} unread={count} logoutAction={logoutAction} available={demoAllowed() ? undefined : providerStatus()}>
      {children}
    </AppShell>
  );
}
