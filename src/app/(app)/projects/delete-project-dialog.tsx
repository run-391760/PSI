"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/input";
import { deleteProjectAction } from "./actions";

/** Confirm-by-typing dialog for deleting a project and all of its tool data. */
export function DeleteProjectDialog({
  project,
  open,
  onClose,
  redirectTo,
}: {
  project: { id: string; name: string; domain: string } | null;
  open: boolean;
  onClose: () => void;
  /** Where to go after deletion (defaults to refreshing the current page). */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const close = () => {
    setTyped("");
    setError(null);
    onClose();
  };
  const confirm = () =>
    project &&
    start(async () => {
      const res = await deleteProjectAction(project.id);
      if (!res.ok) return setError(res.error);
      close();
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    });
  const matches = !!project && typed.trim().toLowerCase() === project.domain.toLowerCase();
  return (
    <Dialog
      open={open && !!project}
      onClose={close}
      title="Delete project?"
      description={project ? `${project.name} (${project.domain})` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} disabled={!matches} loading={pending}>
            Delete project
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px] text-text-2">
        {error && <Callout tone="critical">{error}</Callout>}
        <p>This permanently deletes the project with its audits, tracked keywords, schedules, reports and history. This cannot be undone.</p>
        <Field label={<>Type <span className="font-semibold text-text">{project?.domain}</span> to confirm</>} htmlFor="confirm-domain">
          <Input id="confirm-domain" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder={project?.domain} onKeyDown={(e) => e.key === "Enter" && matches && confirm()} />
        </Field>
      </div>
    </Dialog>
  );
}
