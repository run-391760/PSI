import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Page, PageHeader } from "@/components/shell/page";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { requirePageUser } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { acceptInvite } from "@/lib/cx/admin/users";

export const metadata: Metadata = { title: "Join brand" };

/** Invite link target: the signed-in user joins the brand when their email matches the invite. */
export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  let projectId: string | null = null;
  let error: string | null = null;
  try {
    projectId = (await acceptInvite(token, { id: user.id, email: user.email })).projectId;
  } catch (e) {
    error = e instanceof AppError ? e.message : "This invite couldn't be accepted.";
  }
  if (projectId) redirect(`/cx?brand=${encodeURIComponent(projectId)}`);
  return (
    <Page>
      <PageHeader title="Join brand" breadcrumbs={[{ label: "CX" }, { label: "Invite" }]} />
      <Card><EmptyState title="Invite not accepted" description={error ?? ""} action={<ButtonLink href="/cx">Go to CX</ButtonLink>} /></Card>
    </Page>
  );
}
